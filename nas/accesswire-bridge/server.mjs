import http from "node:http";

const ACCESSWIRE_BASE_URL = "https://www.accessnewswire.com";
const ACCESSWIRE_NEWSROOM_API_URL = `${ACCESSWIRE_BASE_URL}/newsroom/api`;
const ACCESSWIRE_RSS_URL = `${ACCESSWIRE_BASE_URL}/feed/rss2`;
const FDA_BASE_URL = "https://www.fda.gov";
const PARSER_VERSION = "accesswire_nas_raw_bridge_v1";
const ANALYSIS_TEXT_VERSION = "accesswire_analysis_text_v1";
const FDA_PARSER_VERSION = "fda_nas_raw_bridge_v1";
const FDA_ANALYSIS_TEXT_VERSION = "fda_analysis_text_v1";
const PORT = clampNumber(process.env.PORT || 3000, 1, 65535, 3000);
const NAS_INGEST_TOKEN = String(process.env.NAS_INGEST_TOKEN || "").trim();

const ACCESSWIRE_FEEDS = [
  accesswireFeed("All Newsroom Releases", undefined, true),
  accesswireFeed("Aerospace & Defense", "Aerospace & Defense"),
  accesswireFeed("Banking & Financial Services", "Banking & Financial Services"),
  accesswireFeed("Biotechnology", "Biotechnology"),
  accesswireFeed("Business & Professional Services", "Business & Professional Services"),
  accesswireFeed("Computers, Technology & Internet", "Computers, Technology & Internet"),
  accesswireFeed("Consumer & Retail Products", "Consumer & Retail Products"),
  accesswireFeed("Healthcare & Pharmaceutical", "Healthcare & Pharmaceutical"),
  accesswireFeed("Industrial & Manufacturing", "Industrial & Manufacturing"),
  accesswireFeed("Metals & Mining", "Metals & Mining"),
  accesswireFeed("Oil, Gas & Energy", "Oil, Gas & Energy"),
  accesswireFeed("Telecommunications", "Telecommunications"),
  accesswireFeed("Transportation", "Transportation"),
];

const FDA_FEEDS = [
  fdaFeed(
    "Press Releases",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    "press_release",
    true,
  ),
  fdaFeed("What's New: Drugs", "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml", "drugs"),
  fdaFeed(
    "What's New: Vaccines, Blood, and Biologics",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/biologics/rss.xml",
    "biologics",
  ),
  fdaFeed("MedWatch Safety Alerts", "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml", "medwatch"),
];

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "accesswire-raw-bridge",
        parser_version: PARSER_VERSION,
        fda_parser_version: FDA_PARSER_VERSION,
        token_configured: Boolean(NAS_INGEST_TOKEN),
        endpoints: ["/api/accesswire/raw", "/api/fda/raw"],
      });
    }

    if (request.method !== "POST" || !isRawEndpoint(request.url)) {
      return sendJson(response, 404, { ok: false, error: "Not found" });
    }

    if (!NAS_INGEST_TOKEN) {
      return sendJson(response, 500, { ok: false, error: "NAS_INGEST_TOKEN is not configured" });
    }
    if (!isAuthorized(request)) {
      return sendJson(response, 401, { ok: false, error: "Unauthorized" });
    }

    const body = await readJsonBody(request);
    const limit = clampNumber(body.limit ?? 1, 1, 100, 1);
    const sourceUniqueId = typeof body.sourceUniqueId === "string" && body.sourceUniqueId.trim()
      ? body.sourceUniqueId.trim()
      : undefined;
    const includeArticleBody = body.includeArticleBody !== false;
    const articleBodyLimit = includeArticleBody
      ? clampNumber(body.articleBodyLimit ?? limit, 0, limit, limit)
      : 0;
    const result = request.url.startsWith("/api/fda/raw")
      ? await fetchFdaRawItems({ limit, sourceUniqueId, includeArticleBody, articleBodyLimit })
      : await fetchAccesswireRawItems({ limit, sourceUniqueId, includeArticleBody, articleBodyLimit });

    return sendJson(response, result.ok ? 200 : 502, result);
  } catch (error) {
    return sendJson(response, 500, {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Accesswire bridge failed",
    });
  }
});

function isRawEndpoint(url) {
  return Boolean(url?.startsWith("/api/accesswire/raw") || url?.startsWith("/api/fda/raw"));
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`accesswire-raw-bridge listening on ${PORT}`);
});

function isAuthorized(request) {
  const auth = String(request.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = String(request.headers["x-ingest-token"] || "").trim();
  return bearer === NAS_INGEST_TOKEN || headerToken === NAS_INGEST_TOKEN;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function fetchAccesswireRawItems(options = {}) {
  const fetchedAt = new Date().toISOString();
  const rawSourceUniqueId = String(options.sourceUniqueId || "").trim();
  const sourceUniqueId = normalizeSourceUniqueId(rawSourceUniqueId);
  const directArticleUrl = /^https?:\/\//i.test(rawSourceUniqueId)
    ? normalizeAccesswireUrl(rawSourceUniqueId)
    : null;
  const limit = directArticleUrl || sourceUniqueId ? 1 : clampNumber(options.limit ?? 50, 1, 100, 50);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody ? clampNumber(options.articleBodyLimit ?? limit, 0, limit, limit) : 0;

  if (directArticleUrl) {
    return fetchDirectArticleRawItem(directArticleUrl, fetchedAt);
  }

  const items = [];
  const seen = new Set();
  const feedStats = [];
  let discoveryMethod = "newsroom_api";
  let skippedNonEnglish = 0;

  for (const feed of ACCESSWIRE_FEEDS) {
    if (items.length >= limit) break;

    try {
      const apiResponse = await fetchAccesswireNewsroomApi(feed, {
        pageIndex: 0,
        pageSize: Math.min(50, Math.max(limit, 20)),
      });
      if (!apiResponse.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: apiResponse.status,
          itemCount: 0,
          error: apiResponse.error || "Access Newswire newsroom API request failed",
        });
        continue;
      }

      const parsedItems = parseAccesswireNewsroomApi(apiResponse.data, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: apiResponse.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishAccesswireItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (items.length >= limit) break;
      }
      if (sourceUniqueId && items.length) break;
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Access Newswire newsroom API fetch failed",
      });
    }
  }

  if (items.length === 0) {
    discoveryMethod = "browser";
    try {
      const browserResult = await fetchAccesswireBrowserItems({ fetchedAt, limit, sourceUniqueId });
      feedStats.push(browserResult.feedStat);
      for (const item of browserResult.items) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishAccesswireItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (items.length >= limit) break;
      }
    } catch (error) {
      feedStats.push({
        label: "ACCESS Newswire browser newsroom",
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Access Newswire browser discovery failed",
      });
    }
  }

  if (items.length === 0) {
    discoveryMethod = "rss";
    try {
      const rssResult = await fetchAccesswireRssItems({ fetchedAt, limit, sourceUniqueId });
      feedStats.push(rssResult.feedStat);
      for (const item of rssResult.items) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishAccesswireItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (items.length >= limit) break;
      }
    } catch (error) {
      feedStats.push({
        label: "ACCESS Newswire RSS",
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Access Newswire RSS fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => dateMs(b.published_at) - dateMs(a.published_at))
    .slice(0, limit);
  const hydrated = [];
  let articleBodiesFetched = 0;

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchAccesswireArticleHtml(item.source_url);
      if (!articleResponse.ok) {
        hydrated.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: articleResponse.error || `HTTP ${articleResponse.status}`,
            article_fetch_status: articleResponse.status,
          },
        });
        continue;
      }
      const article = parseAccesswireArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "Access Newswire article fetch failed",
        },
      });
    }
  }

  const ok = feedStats.some((feed) => feed.ok) && hydrated.length > 0;
  return {
    ok,
    status: ok ? 200 : firstNonZeroStatus(feedStats) || 0,
    fetchedAt,
    count: hydrated.length,
    items: hydrated,
    diagnostics: {
      feedCount: ACCESSWIRE_FEEDS.length,
      parsedFromFeeds: items.length,
      articleBodiesRequested: articleBodyLimit,
      articleBodiesFetched,
      parserVersion: PARSER_VERSION,
      discoveryMethod,
      skippedNonEnglish,
      feedStats,
    },
    error: ok ? undefined : "No Access Newswire newsroom API feeds could be fetched from NAS bridge.",
  };
}

async function fetchAccesswireBrowserItems({ fetchedAt, limit, sourceUniqueId }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    const articlesFromResponse = [];

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!/\/newsroom\/api\b/i.test(url)) return;
        const data = await response.json().catch(() => null);
        articlesFromResponse.push(...parseAccesswireNewsroomApi(data, {
          feed: accesswireFeed("Browser Newsroom"),
          fetchedAt,
        }));
      } catch {
        // Ignore response parse failures; DOM extraction below is the fallback.
      }
    });

    await page.goto(`${ACCESSWIRE_BASE_URL}/newsroom`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => null);
    await page.waitForSelector("a[href*='/newsroom/']", { timeout: 45000 }).catch(() => null);

    const domItems = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/newsroom/']"));
      return links
        .map((link) => {
          const href = link.href;
          const title =
            link.querySelector("h1,h2,h3,h4")?.textContent?.trim() ||
            link.textContent?.trim() ||
            "";
          const item = link.closest(".gallery-item, article, li, div");
          const text = item?.textContent?.replace(/\s+/g, " ").trim() || "";
          return { href, title, text };
        })
        .filter((item) => item.href && item.title);
    });

    const responseItems = articlesFromResponse.filter((item) => /\/newsroom\//i.test(item.source_url));
    const domRawItems = domItems.map((item) => buildBrowserRawItem(item, fetchedAt)).filter(Boolean);
    const combined = [...responseItems, ...domRawItems];
    const seen = new Set();
    const items = [];

    for (const item of combined) {
      if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
      const key = item.source_unique_id || item.source_url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= Math.max(limit, 20)) break;
    }

    return {
      items,
      feedStat: {
        label: "ACCESS Newswire browser newsroom",
        ok: items.length > 0,
        status: items.length > 0 ? 200 : 0,
        itemCount: items.length,
        error: items.length > 0 ? undefined : "Browser loaded newsroom but no release links were extracted",
      },
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

function buildBrowserRawItem(item, fetchedAt) {
  const sourceUrl = normalizeAccesswireUrl(item.href);
  if (!sourceUrl || !/^https:\/\/www\.accessnewswire\.com\/newsroom\//i.test(sourceUrl)) return null;
  const sourceUniqueId = readReleaseId(sourceUrl);
  const title = decodeHtml(item.title || "").trim() || null;
  const description = item.text ? item.text.slice(0, 1000) : null;
  const tickers = dedupeTickerMentions(extractTickerMentions([title, description].filter(Boolean).join(" ")));
  const candidate = classifyAccesswireCandidate({
    title,
    description,
    tickers,
    industry: readIndustryFromUrl(sourceUrl),
    topic: null,
  });

  return {
    source_code: "accesswire",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title,
    published_at: null,
    fetched_at: fetchedAt,
    body_text: null,
    dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
    raw_payload: {
      provider: "ACCESS Newswire",
      parser_version: PARSER_VERSION,
      feed_label: "Browser Newsroom",
      feed_url: `${ACCESSWIRE_BASE_URL}/newsroom`,
      industry: readIndustryFromUrl(sourceUrl),
      topic: null,
      description,
      tickers,
      metadata_tickers: tickers,
      ticker_source: "browser_listing_debug_only",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

async function fetchAccesswireRssItems({ fetchedAt, limit, sourceUniqueId }) {
  const response = await fetch(ACCESSWIRE_RSS_URL, {
    method: "GET",
    cache: "no-store",
    headers: accesswireRssHeaders(),
  });
  const xml = await response.text();
  if (!response.ok || looksLikeCloudflareChallenge(xml)) {
    return {
      items: [],
      feedStat: {
        label: "ACCESS Newswire RSS",
        ok: false,
        status: response.status,
        itemCount: 0,
        error: response.ok ? "Access Newswire RSS returned Cloudflare challenge" : response.statusText,
      },
    };
  }

  const rssItems = parseAccesswireRss(xml, fetchedAt)
    .filter((item) => /^https:\/\/www\.accessnewswire\.com\/newsroom\//i.test(item.source_url))
    .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, Math.max(limit, 20));

  return {
    items: rssItems,
    feedStat: {
      label: "ACCESS Newswire RSS",
      ok: true,
      status: response.status,
      itemCount: rssItems.length,
    },
  };
}

function parseAccesswireRss(xml, fetchedAt) {
  const items = [];
  const pattern = /<item\b[\s\S]*?<\/item>/gi;
  let match;
  while ((match = pattern.exec(xml))) {
    const itemXml = match[0];
    const title = decodeHtml(readXmlTag(itemXml, "title") || "");
    const sourceUrl = normalizeAccesswireUrl(readXmlTag(itemXml, "link"));
    if (!sourceUrl) continue;
    const sourceUniqueId = readReleaseId(sourceUrl);
    const description = textFromHtml(readXmlTag(itemXml, "description") || "");
    const publishedAt = parseAccesswireDate(readXmlTag(itemXml, "pubDate"));
    const category = decodeHtml(readXmlTag(itemXml, "category") || "").trim() || null;
    const tickers = dedupeTickerMentions(extractTickerMentions([title, description].filter(Boolean).join(" ")));
    const candidate = classifyAccesswireCandidate({
      title,
      description,
      tickers,
      industry: readIndustryFromUrl(sourceUrl),
      topic: category,
    });

    items.push({
      source_code: "accesswire",
      source_group: "news",
      source_unique_id: sourceUniqueId,
      source_url: sourceUrl,
      title,
      published_at: publishedAt,
      fetched_at: fetchedAt,
      body_text: null,
      dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
      raw_payload: {
        provider: "ACCESS Newswire",
        parser_version: PARSER_VERSION,
        feed_label: "ACCESS Newswire RSS",
        feed_url: ACCESSWIRE_RSS_URL,
        industry: readIndustryFromUrl(sourceUrl),
        topic: category,
        description,
        tickers,
        metadata_tickers: tickers,
        ticker_source: "rss_metadata_debug_only",
        candidate_class: candidate.candidateClass,
        candidate_reason: candidate.reason,
        candidate_signals: candidate.signals,
        low_value_reasons: candidate.lowValueReasons,
        sector_impact_signals: candidate.sectorImpactSignals,
      },
    });
  }
  return items;
}

async function fetchDirectArticleRawItem(sourceUrl, fetchedAt) {
  try {
    const articleResponse = await fetchAccesswireArticleHtml(sourceUrl);
    if (!articleResponse.ok) {
      return {
        ok: false,
        status: articleResponse.status,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: baseDirectArticleDiagnostics(articleResponse.status, articleResponse.error),
        error: articleResponse.error || "Direct Access Newswire article could not be parsed",
      };
    }

    const article = parseAccesswireArticleHtml(articleResponse.html, articleResponse.url);
    const rawItem = buildArticleRawItem(article, fetchedAt);
    return {
      ok: Boolean(rawItem),
      status: rawItem ? 200 : 0,
      fetchedAt,
      count: rawItem ? 1 : 0,
      items: rawItem ? [rawItem] : [],
      diagnostics: baseDirectArticleDiagnostics(rawItem ? 200 : 0, rawItem ? undefined : "Direct article parse failed"),
      error: rawItem ? undefined : "Direct Access Newswire article could not be parsed",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: baseDirectArticleDiagnostics(0, error instanceof Error ? error.message : "Direct article fetch failed"),
      error: error instanceof Error ? error.message : "Direct article fetch failed",
    };
  }
}

function parseAccesswireNewsroomApi(data, { feed, fetchedAt }) {
  const record = readRecord(data);
  const dataRecord = readRecord(record?.data) || record;
  const articles = Array.isArray(dataRecord?.articles) ? dataRecord.articles : [];

  return articles
    .map((rawArticle) => {
      const article = readRecord(rawArticle);
      if (!article) return null;
      const title = readString(article.title) || readString(article.headline);
      const sourceUrl = normalizeAccesswireUrl(
        readString(article.releaseurl) ||
          readString(article.releaseUrl) ||
          readString(article.url) ||
          readString(article.link),
      );
      if (!sourceUrl) return null;

      const sourceUniqueId =
        readString(article.id) ||
        readString(article.releaseid) ||
        readString(article.releaseId) ||
        readReleaseId(sourceUrl);
      const description = textFromHtml(readString(article.description) || readString(article.summary));
      const publishedAt = parseAccesswireDate(
        readString(article.adate) ||
          readString(article.date) ||
          readString(article.published_at) ||
          readString(article.publishedAt),
      );
      const topic = readFirstString(article.topics) || readString(article.topic) || feed.topic || null;
      const industry = readString(article.articleindustry) || readString(article.industry) || feed.industry || null;
      const companyName = readString(article.company) || readString(article.author) || null;
      const metadataTickers = dedupeTickerMentions(
        extractTickerMentions([title, description, companyName].filter(Boolean).join(" ")),
      );
      const candidate = classifyAccesswireCandidate({
        title,
        description,
        tickers: metadataTickers,
        industry,
        topic,
      });

      return {
        source_code: "accesswire",
        source_group: "news",
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: publishedAt,
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "ACCESS Newswire",
          parser_version: PARSER_VERSION,
          feed_label: feed.label,
          feed_url: feed.url,
          industry,
          topic,
          company_name: companyName,
          description,
          newsroom_article: article,
          tickers: metadataTickers,
          metadata_tickers: metadataTickers,
          ticker_source: "newsroom_metadata_debug_only",
          candidate_class: candidate.candidateClass,
          candidate_reason: candidate.reason,
          candidate_signals: candidate.signals,
          low_value_reasons: candidate.lowValueReasons,
          sector_impact_signals: candidate.sectorImpactSignals,
        },
      };
    })
    .filter(Boolean);
}

async function fetchAccesswireNewsroomApi(feed, options) {
  const url = new URL(feed.url || ACCESSWIRE_NEWSROOM_API_URL);
  url.searchParams.set("pageindex", String(options.pageIndex));
  url.searchParams.set("pageSize", String(options.pageSize));
  if (feed.industry) url.searchParams.set("articleindustry", feed.industry);
  if (feed.topic) url.searchParams.set("topic", feed.topic);

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: accesswireFetchHeaders("api", feed),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: looksLikeCloudflareChallenge(text)
        ? "Access Newswire newsroom API returned Cloudflare challenge"
        : response.statusText || "Access Newswire newsroom API request failed",
    };
  }

  const data = safeJsonParse(text);
  return {
    ok: Boolean(data),
    status: response.status,
    data,
    error: data ? undefined : "Access Newswire newsroom API returned non-JSON response",
  };
}

async function fetchAccesswireArticleHtml(sourceUrl) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: accesswireFetchHeaders("html"),
  });
  const html = await response.text();

  return {
    ok: response.ok && !looksLikeCloudflareChallenge(html),
    status: response.status,
    url: response.url || sourceUrl,
    html: response.ok ? html : "",
    error: response.ok
      ? looksLikeCloudflareChallenge(html)
        ? "Access Newswire article returned Cloudflare challenge"
        : undefined
      : response.statusText || "Access Newswire article request failed",
  };
}

function parseAccesswireArticleHtml(html, url) {
  const normalizedUrl = normalizeAccesswireUrl(url) || url;
  const bodyHtml = extractAccesswireBodyHtml(html);
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripAccesswireAnalysisBoilerplate(bodyText);
  const title = readMetaContent(html, "og:title") || readMetaContent(html, "twitter:title") || readTitle(html);
  const description =
    readMetaContent(html, "description") ||
    readMetaContent(html, "og:description") ||
    readMetaContent(html, "twitter:description");
  const companyName =
    readMetaContent(html, "author") ||
    readMetaContent(html, "og:article:author") ||
    readSourceCompanyFromBody(bodyHtml);
  const topic = readMetaContent(html, "og:article:tag") || readTopicFromHeader(html);
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions([title, description, companyName, topic].filter(Boolean).join(" ")),
  );

  return {
    url: normalizedUrl,
    title,
    publishedAt: parseAccesswireDate(readMetaContent(html, "og:article:published_time") || readHeaderDate(html)),
    sourceName: "ACCESS Newswire",
    companyName,
    topic,
    description,
    bodyHtml: fullTextHtml,
    bodyText,
    tickers: bodyTickers,
    rawPayload: {
      canonical_url: readCanonicalUrl(html),
      full_text_html: fullTextHtml,
      body_tickers: bodyTickers,
      metadata_tickers: metadataTickers,
      ticker_source: bodyText ? "article_body" : "none",
      analysis_text: analysisText.text,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: analysisText.text?.length || 0,
      removed_analysis_sections: analysisText.removedSections,
    },
  };
}

function buildArticleRawItem(article, fetchedAt) {
  const sourceUniqueId = readReleaseId(article.url);
  const candidate = classifyAccesswireCandidate({
    title: article.title,
    description: buildCandidateClassificationText(article.description, article.rawPayload.analysis_text || article.bodyText),
    tickers: article.tickers,
    industry: readIndustryFromUrl(article.url),
    topic: article.topic,
  });

  return {
    source_code: "accesswire",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: article.url,
    title: article.title,
    published_at: article.publishedAt,
    fetched_at: fetchedAt,
    body_text: article.bodyText,
    dedupe_key: buildDedupeKey(sourceUniqueId, article.url),
    raw_payload: {
      provider: "ACCESS Newswire",
      parser_version: PARSER_VERSION,
      source_name: article.sourceName,
      company_name: article.companyName,
      topic: article.topic,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      tickers: article.tickers,
      body_tickers: article.rawPayload.body_tickers || [],
      metadata_tickers: article.rawPayload.metadata_tickers || [],
      ticker_source: article.bodyText ? "article_body" : "none",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function mergeArticleIntoRawItem(item, article) {
  const searchTickers = Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const industry = readString(item.raw_payload.industry) || readIndustryFromUrl(article.url);
  const topic = article.topic || readString(item.raw_payload.topic);
  const candidate = classifyAccesswireCandidate({
    title: article.title || item.title,
    description: buildCandidateClassificationText(
      article.description || readString(item.raw_payload.description),
      article.rawPayload.analysis_text || article.bodyText,
    ),
    tickers,
    industry,
    topic,
  });

  return {
    ...item,
    title: article.title || item.title,
    published_at: article.publishedAt || item.published_at,
    source_url: article.url || item.source_url,
    body_text: article.bodyText,
    raw_payload: {
      ...item.raw_payload,
      source_name: article.sourceName || item.raw_payload.source_name,
      company_name: article.companyName || item.raw_payload.company_name,
      topic,
      industry,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      ticker_source: article.bodyText ? "article_body" : "newsroom_listing",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

async function fetchFdaRawItems(options = {}) {
  const fetchedAt = new Date().toISOString();
  const sourceUniqueId = fdaNormalizeSourceUniqueId(options.sourceUniqueId);
  const limit = sourceUniqueId ? 1 : clampNumber(options.limit ?? 25, 1, 100, 25);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody ? clampNumber(options.articleBodyLimit ?? limit, 0, limit, limit) : 0;
  const items = [];
  const seen = new Set();
  const feedStats = [];
  let skippedNonEnglish = 0;

  for (const feed of FDA_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: fdaFetchHeaders("rss"),
      });
      const xml = await response.text();
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.statusText || "FDA RSS request failed",
        });
        continue;
      }

      const parsedItems = parseFdaRssXml(xml, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (sourceUniqueId && fdaNormalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishFdaItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (sourceUniqueId && items.length >= limit) break;
      }
      if (sourceUniqueId && items.length >= limit) break;
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "FDA RSS fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => fdaCandidatePriority(b) - fdaCandidatePriority(a) || dateMs(b.published_at) - dateMs(a.published_at))
    .filter((item) => !sourceUniqueId || fdaNormalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, limit);
  const hydrated = [];
  let articleBodiesFetched = 0;

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchFdaArticleHtml(item.source_url);
      if (!articleResponse.ok) {
        hydrated.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: articleResponse.error || `HTTP ${articleResponse.status}`,
            article_fetch_status: articleResponse.status,
          },
        });
        continue;
      }

      const article = parseFdaArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeFdaArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "FDA article fetch failed",
        },
      });
    }
  }

  const ok = feedStats.some((feed) => feed.ok);
  return {
    ok,
    status: ok ? 200 : firstNonZeroStatus(feedStats) || 0,
    fetchedAt,
    count: hydrated.length,
    items: hydrated,
    diagnostics: {
      feedCount: FDA_FEEDS.length,
      parsedFromFeeds: items.length,
      articleBodiesRequested: articleBodyLimit,
      articleBodiesFetched,
      parserVersion: FDA_PARSER_VERSION,
      skippedNonEnglish,
      feedStats,
    },
    error: ok ? undefined : "No FDA feeds could be fetched",
  };
}

function parseFdaRssXml(xml, { feed, fetchedAt }) {
  const items = [];
  const pattern = /<item\b[\s\S]*?<\/item>/gi;
  let match;
  while ((match = pattern.exec(xml || ""))) {
    const itemXml = match[0];
    const title = decodeHtml(readXmlTag(itemXml, "title") || "").trim() || null;
    const sourceUrl = normalizeFdaUrl(readXmlTag(itemXml, "link") || readXmlTag(itemXml, "guid"));
    if (!sourceUrl) continue;

    const descriptionHtml = readXmlTag(itemXml, "description");
    const description = textFromHtml(descriptionHtml);
    const sourceUniqueId = readFdaId(sourceUrl) || readXmlTag(itemXml, "guid");
    const metadataTickers = dedupeTickerMentions(extractTickerMentions([title, description].filter(Boolean).join(" ")));
    const candidate = classifyFdaCandidate({
      title,
      description,
      feedKind: feed.kind,
      tickers: metadataTickers,
    });

    items.push({
      source_code: "fda",
      source_group: "news",
      source_unique_id: sourceUniqueId,
      source_url: sourceUrl,
      title,
      published_at: parseFdaDate(readXmlTag(itemXml, "pubDate")),
      fetched_at: fetchedAt,
      body_text: null,
      dedupe_key: buildFdaDedupeKey(sourceUniqueId, sourceUrl),
      raw_payload: {
        provider: "FDA",
        source_name: "FDA",
        parser_version: FDA_PARSER_VERSION,
        feed_label: feed.label,
        feed_kind: feed.kind,
        feed_url: feed.url,
        description,
        description_html: descriptionHtml,
        rss_guid: readXmlTag(itemXml, "guid"),
        tickers: metadataTickers,
        metadata_tickers: metadataTickers,
        ticker_source: "rss_metadata_debug_only",
        candidate_class: candidate.candidateClass,
        candidate_reason: candidate.reason,
        candidate_signals: candidate.signals,
        low_value_reasons: candidate.lowValueReasons,
        sector_impact_signals: candidate.sectorImpactSignals,
      },
    });
  }
  return items;
}

async function fetchFdaArticleHtml(sourceUrl) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: fdaFetchHeaders("html"),
  });
  const html = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || sourceUrl,
    html: response.ok ? html : "",
    error: response.ok ? undefined : response.statusText || "FDA article request failed",
  };
}

function parseFdaArticleHtml(html, url) {
  const normalizedUrl = normalizeFdaUrl(url) || url;
  const mainHtml = extractFdaMainHtml(html);
  const fullTextHtml = sanitizeArticleHtml(mainHtml);
  const bodyText = mainHtml ? textFromHtml(mainHtml) : null;
  const analysisText = stripFdaAnalysisBoilerplate(bodyText);
  const title = readMetaContent(html, "og:title") || readFdaTitleText(html);
  const description = readMetaContent(html, "description") || readMetaContent(html, "og:description");
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions([title, description, readMetaContent(html, "keywords")].filter(Boolean).join(" ")),
  );

  return {
    url: normalizedUrl,
    title,
    publishedAt: readFdaPublishedAt(html),
    sourceName: "FDA",
    description,
    bodyHtml: fullTextHtml,
    bodyText,
    tickers: bodyTickers,
    rawPayload: {
      canonical_url: fdaReadCanonicalUrl(html),
      full_text_html: fullTextHtml,
      body_tickers: bodyTickers,
      metadata_tickers: metadataTickers,
      ticker_source: bodyText ? "article_body" : "none",
      analysis_text: analysisText.text,
      analysis_text_version: FDA_ANALYSIS_TEXT_VERSION,
      analysis_text_chars: analysisText.text?.length || 0,
      removed_analysis_sections: analysisText.removedSections,
    },
  };
}

function mergeFdaArticleIntoRawItem(item, article) {
  const searchTickers = Array.isArray(item.raw_payload.tickers) ? item.raw_payload.tickers : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const feedKind = readString(item.raw_payload.feed_kind) || "press_release";
  const candidate = classifyFdaCandidate({
    title: article.title || item.title,
    description: [article.description, article.rawPayload.analysis_text || article.bodyText].filter(Boolean).join("\n"),
    feedKind,
    tickers,
  });

  return {
    ...item,
    title: article.title || item.title,
    published_at: item.published_at || article.publishedAt,
    source_url: article.url || item.source_url,
    body_text: article.bodyText,
    raw_payload: {
      ...item.raw_payload,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || FDA_ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      body_tickers: article.rawPayload.body_tickers || [],
      metadata_tickers: article.rawPayload.metadata_tickers || [],
      ticker_source: article.bodyText ? "article_body" : "rss_listing",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function classifyFdaCandidate({ title, description, feedKind, tickers }) {
  const text = normalizeFilterText([title, description, feedKind].filter(Boolean).join("\n"));
  const titleText = normalizeFilterText(title || "");
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findFdaLowValueReasons(text);
  const sectorImpactSignals = findFdaSectorImpactSignals(text, feedKind);
  const highValueAgencyAction = hasFdaHighValueAgencyActionSignal(text, feedKind);
  const titleHighValueAgencyAction = hasFdaHighValueAgencyActionSignal(titleText, feedKind);
  const safetyRecallAction = hasFdaSafetyRecallAction(text, feedKind);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...(highValueAgencyAction ? ["agency_action"] : []),
    ...(hasUsTicker ? ["us_ticker"] : []),
    "official_agency_source",
  ];

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in FDA item body.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !titleHighValueAgencyAction && !safetyRecallAction) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value FDA page: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length || highValueAgencyAction || feedKind === "press_release" || feedKind === "medwatch") {
    return {
      candidateClass: "sector_theme_policy_candidate",
      reason: sectorImpactSignals.length
        ? `FDA agency candidate: ${sectorImpactSignals.join(", ")}`
        : "FDA agency candidate from official FDA feed.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "low_value_filtered",
    reason: "Filtered before LLM because FDA page has no clear market-relevant agency action.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findFdaLowValueReasons(text) {
  const rules = [
    ["data_files_or_static_database", /\b(data files?|downloadable data|database|listing includes|list of determinations|determinations including written request|cleared 510\(?k\)? submissions with supporting documents|annual reports?|accelerated approvals|novel drug approvals|approval notifications|patent certifications|suitability petitions|potential signals of serious risks)\b/i],
    ["conference_or_training", /\b(conference|webinar|workshop|training|education|listening session|public meeting|town hall)\b/i],
    ["guidance_resource", /\b(guidance document|draft guidance|question[- ]and[- ]answer|q&a|faq|resource page|user fee amendments|medication errors related)\b/i],
    ["static_product_label_page", /\b(product approval indicated|proper name:|tradename:|stn:\s*(?:bl|bn)\b|package insert)\b/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function hasFdaHighValueAgencyActionSignal(text, feedKind) {
  if (feedKind === "medwatch" && /\b(?:recall|safety alert|adverse event|contamination|defect)\b/i.test(text)) {
    return true;
  }
  return [
    /\bfda\s+(?:approves?|approved|clears?|cleared|grants?|issued?|announced?|finalizes?|launches?)\b/i,
    /\bmay be harmful\b/i,
    /\b(?:early alert|potentially high-risk device issue|medical device recalls?)\b/i,
    /\b(?:issued?|grants?)\s+(?:an?\s+)?approval\b/i,
    /\b(?:complete response letter|crl|safety alert|drug safety communication|warning letter|shortage)\b/i,
    /\b(?:breakthrough therapy|orphan drug|fast track|priority review|pdufa date|advisory committee)\b/i,
    /\b(?:voluntary|nationwide|class i|class ii)\s+recall\b/i,
  ].some((pattern) => pattern.test(text));
}

function hasFdaSafetyRecallAction(text, feedKind) {
  const safetyPattern =
    /\b(?:early alert|potentially high-risk device issue|medical device recalls?|class\s+(?:i|ii)\s+recall|nationwide recall|voluntary recall|safety alert|drug safety communication|boxed warning|contamination|defect)\b/i;
  return safetyPattern.test(text) || (feedKind === "medwatch" && /\b(?:recall|removes?|removing|corrected?|replaced?)\b/i.test(text));
}

function findFdaSectorImpactSignals(text, feedKind) {
  const rules = [
    ["fda_approval_clearance", /\b(?:approval|approves?|approved|clearance|cleared|accelerated approval|priority voucher)\b/i],
    ["fda_safety_recall", /\b(?:recall|safety alert|medwatch|adverse event|boxed warning|contamination|defect)\b/i],
    ["fda_policy_regulation", /\b(?:rule|program|policy|guidance|post-market assessment|regulatory|soliciting input)\b/i],
    ["clinical_regulatory_milestone", /\b(?:clinical trial|breakthrough therapy|orphan drug|fast track|pdufa|advisory committee)\b/i],
    ["public_health", /\b(?:outbreak|public health|infectious disease|vaccine|shortage)\b/i],
  ];
  const signals = rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
  if (feedKind === "medwatch" && !signals.includes("fda_safety_recall")) signals.push("fda_safety_recall");
  return signals;
}

function stripFdaAnalysisBoilerplate(bodyText) {
  if (!bodyText) return { text: null, removedSections: [] };
  const cut = findFdaBoilerplateCut(bodyText);
  if (!cut) return { text: bodyText, removedSections: [] };
  const keptText = bodyText.slice(0, cut.index).trim();
  const removedText = bodyText.slice(cut.index).trim();
  return {
    text: keptText || bodyText,
    removedSections: keptText
      ? [
          {
            kind: "analysis_tail_or_boilerplate",
            label: cut.label,
            start_index: cut.index,
            char_count: removedText.length,
            preview: removedText.slice(0, 240),
          },
        ]
      : [],
  };
}

function findFdaBoilerplateCut(bodyText) {
  const candidates = [
    findPatternCut(bodyText, /(?:^|\n)\s*(The FDA, an agency within the U\.S\. Department of Health and Human Services\b[^\n]*)/i, "FDA boilerplate"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Media:\s*\n|Consumer:\s*\n|For (?:media|consumer|press) inquiries\b[^\n]*)/i, "FDA contact information"),
    findPatternCut(bodyText, /(?:^|\n)\s*(###)\s*(?:\n|$)/i, "FDA release terminator"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Content current as of:\b[^\n]*)/i, "FDA page metadata"),
  ].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.index - b.index)[0];
}

function extractFdaMainHtml(html) {
  const roleMainMatch = /<div[^>]*role=["']main["'][^>]*>/i.exec(html || "");
  if (roleMainMatch?.index != null) {
    const start = roleMainMatch.index;
    const end = html.indexOf("<aside", start + roleMainMatch[0].length);
    return end > start ? html.slice(start, end) : html.slice(start);
  }

  const mainMatch = /<main\b[^>]*>/i.exec(html || "");
  if (mainMatch?.index != null) {
    const start = mainMatch.index;
    const end = html.search(/<\/main>/i);
    return end > start ? html.slice(start, end + "</main>".length) : html.slice(start);
  }

  return "";
}

function readFdaPublishedAt(html) {
  const timeValue = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  return parseFdaDate(timeValue) || parseFdaDate(readMetaContent(html, "article:published_time"));
}

function fdaReadCanonicalUrl(html) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return normalizeFdaUrl(match?.[1]);
}

function readFdaTitleText(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return textFromHtml(h1);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? textFromHtml(title) : null;
}

function fdaFetchHeaders(kind) {
  return {
    Accept: kind === "rss" ? "application/rss+xml,application/xml,text/xml,*/*" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 FDA raw parser",
  };
}

function normalizeFdaUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), FDA_BASE_URL);
    url.protocol = "https:";
    url.hostname = "www.fda.gov";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function fdaNormalizeSourceUniqueId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return readFdaId(text) || text;
}

function readFdaId(url) {
  try {
    const parsed = new URL(url, FDA_BASE_URL);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1) || null;
  } catch {
    return null;
  }
}

function buildFdaDedupeKey(sourceUniqueId, sourceUrl) {
  return `fda:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function isEnglishFdaItem() {
  return true;
}

function parseFdaDate(value) {
  const text = readString(value);
  if (!text) return null;
  const normalized = decodeHtml(text)
    .replace(/\bEDT\b/i, "-0400")
    .replace(/\bEST\b/i, "-0500")
    .replace(/\bCDT\b/i, "-0500")
    .replace(/\bCST\b/i, "-0600");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function fdaCandidatePriority(item) {
  const candidateClass = readString(item.raw_payload.candidate_class);
  if (candidateClass === "company_event") return 4;
  if (candidateClass === "sector_theme_policy_candidate") return 3;
  if (candidateClass === "ticker_archive_candidate") return 2;
  if (candidateClass === "low_value_filtered") return 0;
  return 1;
}

function fdaFeed(label, url, kind, primary = false) {
  return { label, url, kind, primary };
}

function classifyAccesswireCandidate({ title, description, tickers, industry, topic }) {
  const text = normalizeFilterText([title, description, industry, topic].filter(Boolean).join("\n"));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findLowValueReasons(text);
  const materialCompanyEvent = hasMaterialCompanyEventSignal(text);
  const sectorImpactSignals = findSectorImpactSignals(text);
  const broadUsTransmission = hasBroadUsMarketTransmission(text, sectorImpactSignals);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    materialCompanyEvent ? "material_company_event" : "",
    hasUsTicker ? "us_ticker" : "",
  ].filter(Boolean);

  if (hasUsTicker && materialCompanyEvent) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker with a current company event signal.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !materialCompanyEvent && !(hasUsTicker && sectorImpactSignals.length > 0)) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value Access Newswire item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in Access Newswire release body/listing.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (!broadUsTransmission) {
    return {
      candidateClass: "low_value_filtered",
      reason:
        "Filtered before LLM because Access Newswire item has no U.S.-listed ticker or clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: sectorImpactSignals.length
      ? `Sector/theme/policy candidate from Access Newswire feed: ${sectorImpactSignals.join(", ")}`
      : "Broad Access Newswire sector candidate; not filtered by low-value rules.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findLowValueReasons(text) {
  const rules = [
    ["advertorial_or_affiliate", /\b(advertorial|affiliate links?|commission may be earned|sponsored content)\b/i],
    ["shareholder_lawsuit_ad", /\b(shareholder alert|lead plaintiff|class action|securities fraud|investor deadline|law firm|investigates?|investors? with losses|lost money on)\b/i],
    ["award_or_ranking", /\b(award|awards|honou?r|honou?rs|ranking|ranked|recognition|winner|wins?|top employer)\b/i],
    ["local_opening", /\b(grand opening|opens? new|new showroom|new office|new location|ribbon cutting|store opening|branch opening)\b/i],
    ["expert_advice", /\b(expert explains|offers guidance|tips for|how to|what are the|why does|thought leadership|commentary|q&a)\b/i],
    ["marketing_campaign", /\b(brand campaign|launches campaign|sweepstakes|giveaway|limited-time offer|discount|promo(?:tional)?|announces sponsorship|sponsors)\b/i],
    ["conference_presence", /\b(to present at|will present at|to participate in|will participate in|attend(?:s|ing)?|exhibit(?:s|ing)? at|booth|webinar|investor day|analyst day|capital markets day|webcast.{0,80}presentation)\b/i],
    ["csr_or_community", /\b(charity|foundation|donation|scholarship|community event|volunteer|philanthrop|nonprofit|pro bono)\b/i],
    ["survey_or_report_marketing", /\b(survey|poll|study finds|report reveals|white paper|market research report|customer satisfaction rating)\b/i],
    ["third_party_research_coverage", /\b(?:initiates?|starts?|launches?)\s+coverage\b|\bresearch (?:coverage|report)\b|\banalyst report\b/i],
    ["private_product_promo", /\b(new product line|expands?.{0,80}(?:product line|portfolio|platform|line)|unveils?.{0,80}(?:portfolio|platform|product)|product launch|available now|commercially available|consumer alert)\b/i],
    ["real_estate_or_tourism_promo", /\b(luxury resort|branded residences|tourism offerings|destination|hotel opening|travel enthusiasts)\b/i],
    ["personnel_or_culture", /\b(appoints?|joins? as|new ceo|new cfo|graduates?|commencement|diversity|people and culture|workforce culture)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function hasMaterialCompanyEventSignal(text) {
  return [
    /\b(?:reports?|announces?|posts?)\b.{0,120}\b(?:quarter|fiscal|q[1-4]|annual|year[- ]end)\b.{0,80}\b(?:financial results?|results?|earnings)\b/i,
    /\b(?:financial results?|earnings release date|earnings call|conference call)\b/i,
    /\b(?:monthly distribution|quarterly dividend|cash dividend|dividend increase|ex-dividend|record date|payment date)\b/i,
    /\b(?:share repurchase|stock repurchase|buyback|capital return|public offering|registered direct|private placement|stock split|reverse split|share issuance)\b/i,
    /\b(?:merger|acquisition|takeover|definitive agreement|bankruptcy|restructuring|strategic alternatives|joint venture)\b/i,
    /\b(?:raises guidance|raises outlook|lowers guidance|cuts guidance|reaffirms guidance|updates guidance|reiterates guidance)\b/i,
    /\b(?:clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|topline results?|primary endpoint|readout)\b/i,
    /\b(?:material contract|major contract|government contract|defense contract|supply agreement|master research agreement|grant milestones?)\b/i,
  ].some((pattern) => pattern.test(text));
}

function findSectorImpactSignals(text) {
  const rules = [
    ["geopolitical_security", /\b(war|military conflict|invasion|missile|drone attack|airstrike|border conflict|geopolitical|national security|terror|weapon system)\b/i],
    ["sanctions_trade_controls", /\b(sanction|tariff|export control|import ban|trade restriction|customs duty|anti-dumping|countervailing|embargo|blacklist|entity list)\b/i],
    ["public_health", /\b(pandemic|epidemic|outbreak|virus|infectious disease|cdc|public health emergency|avian flu|h5n1|covid|vaccine shortage)\b/i],
    ["supply_chain_logistics", /\b(supply chain|shortage|disruption|port closure|shipping lane|freight|rail disruption|rail strike|truck strike|warehouse disruption|logistics bottleneck)\b/i],
    ["energy_commodity", /\b(oil price|natural gas|lng|uranium|lithium|copper|rare earth|critical minerals|commodity prices|power prices|grid reliability|electricity shortage|refinery outage|antimony|tungsten)\b/i],
    ["regulatory_agency", /\b(regulation|regulatory|agency action|epa|fda|cdc|doe|dod|department of war|dla|ftc|fcc|ferc|cftc|sec rule|antitrust|compliance deadline|rulemaking)\b/i],
    ["labor_infrastructure", /\b(strike|walkout|lockout|union action|labor dispute|infrastructure failure|bridge collapse|airport shutdown|port shutdown|plant shutdown|factory shutdown)\b/i],
    ["cyber_data_risk", /\b(cyberattack|ransomware|data breach|security breach|critical vulnerability|malware|phishing campaign|identity theft|system outage)\b/i],
    ["disaster_climate", /\b(hurricane|wildfire|flood|earthquake|tornado|drought|heatwave|winter storm|natural disaster|climate risk|evacuation)\b/i],
    ["defense_procurement", /\b(defense contract|government procurement|dod contract|department of war|dla contract|navy contract|army contract|air force contract|weapons procurement|munitions|shipbuilding contract)\b/i],
    ["ai_semiconductor_infrastructure", /\b(ai chip|artificial intelligence infrastructure|semiconductor|asic|gpu|data center|advanced packaging|wafer|foundry|memory chip|chip supply|hpc|compute capacity|ai infrastructure)\b/i],
    ["clinical_regulatory_milestone", /\b(clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|clinical data|late[- ]breaking data|topline results?|primary endpoint|readout)\b/i],
    ["healthcare_access_reimbursement", /\b(medicare|medicaid|reimbursement|drug pricing|pbm|pharmacy benefit|hospital capacity|medical supply shortage|health insurance premium)\b/i],
    ["financial_systemic", /\b(bank failure|credit crunch|liquidity stress|systemic risk|debt ceiling|sovereign debt|rate shock|bond market disruption)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function hasBroadUsMarketTransmission(text, sectorImpactSignals) {
  if (!sectorImpactSignals.length) return false;
  if (/\b(united states|u\.s\.|us market|nasdaq|nyse|otc|american depositary|adr|department of war|dla)\b/i.test(text)) {
    return true;
  }
  return sectorImpactSignals.some((signal) =>
    [
      "sanctions_trade_controls",
      "energy_commodity",
      "supply_chain_logistics",
      "financial_systemic",
      "geopolitical_security",
      "public_health",
      "ai_semiconductor_infrastructure",
      "defense_procurement",
    ].includes(signal),
  );
}

function stripAccesswireAnalysisBoilerplate(bodyText) {
  if (!bodyText) return { text: null, removedSections: [] };
  const cut = findBoilerplateCut(bodyText);
  if (!cut) return { text: bodyText, removedSections: [] };
  const keptText = bodyText.slice(0, cut.index).trim();
  const removedText = bodyText.slice(cut.index).trim();
  return {
    text: keptText || bodyText,
    removedSections: keptText
      ? [
          {
            kind: "analysis_tail_or_boilerplate",
            label: cut.label,
            start_index: cut.index,
            char_count: removedText.length,
            preview: removedText.slice(0, 240),
          },
        ]
      : [],
  };
}

function findBoilerplateCut(bodyText) {
  const candidates = [
    findPatternCut(bodyText, /(?:^|\n)\s*((?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information|Language)[^\n]*)/i, "Forward-Looking Statements"),
    findPatternCut(bodyText, /(?:^|\n)\s*((?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?[^\n]*)/i, "Forward-Looking Statements"),
    findPatternCut(bodyText, /(?:^|\n)\s*(This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?)/i, "Forward-Looking Statements"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[- ]looking\s+statements?)/i, "Forward-Looking Statements"),
    findPatternCut(bodyText, /(?:^|\n)\s*(About\s+[A-Z0-9][^\n]{0,120})/i, "About Company"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Contacts?|Investor Relations Contact|Media Relations Contact|For (?:further )?(?:information|media inquiries|investor inquiries|more information)\b[^\n]*)/i, "Contact Information"),
  ].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.index - b.index)[0];
}

function findPatternCut(bodyText, pattern, label) {
  const match = pattern.exec(bodyText);
  if (!match || match.index < 0) return null;
  const leadingNewlineOffset = (match[0] || "").startsWith("\n") ? 1 : 0;
  const index = match.index + leadingNewlineOffset;
  if (index < 80) return null;
  return { index, label };
}

function extractAccesswireBodyHtml(html) {
  const bodyPattern =
    /<div\b(?=[^>]*\bdata-inline-binding=(["'])dynamic_page_collection\.body\1)(?=[^>]*\bclass=(["'])(?=[^"']*\barticle-update\b)[^"']*\2)[^>]*>/i;
  const match = bodyPattern.exec(html);
  if (match?.index !== undefined) return extractBalancedElementAt(html, match.index, "div");

  const fallbackPattern = /<div\b[^>]*\bclass=(["'])(?=[^"']*\bmain-article\b)[^"']*\1[^>]*>/i;
  const fallback = fallbackPattern.exec(html);
  if (fallback?.index === undefined) return null;
  const fallbackHtml = extractBalancedElementAt(html, fallback.index, "div");
  if (!fallbackHtml) return null;
  const nested = bodyPattern.exec(fallbackHtml);
  if (nested?.index !== undefined) return extractBalancedElementAt(fallbackHtml, nested.index, "div");
  return fallbackHtml;
}

function extractBalancedElementAt(html, startIndex, tagName) {
  const tagPattern = new RegExp(`</?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 0;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(html))) {
    if (tagMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, tagPattern.lastIndex);
    } else if (!tagMatch[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return null;
}

function sanitizeArticleHtml(html) {
  if (!html) return null;
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\sdata-[a-z0-9_-]+=(["']).*?\1/gi, "")
    .replace(/\son[a-z]+=(["']).*?\1/gi, "")
    .trim();
}

function textFromHtml(html) {
  if (!html) return null;
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function extractTickerMentions(text) {
  const mentions = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca|\s+Texas)?|NYSEAMERICAN|AMEX|Cboe|CBOE|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC|TSX\s+Venture\s+Exchange|TSXV|TSX|CSE|FSE|XETRA|SIX|LSE|AIM|ASX))\s*(?::|\uFF1A)\s*([A-Z][A-Z0-9.-]{0,9})\b/g;
  for (const match of text.matchAll(pattern)) {
    const exchange = normalizeExchange(match[1]);
    const symbol = match[2].replace(/[.,;:)]+$/g, "").toUpperCase();
    if (!symbol) continue;
    mentions.push({
      exchange,
      symbol,
      raw: match[0],
      usListed: isUsExchange(exchange),
    });
  }
  return mentions;
}

function dedupeTickerMentions(tickers) {
  const seen = new Set();
  const result = [];
  for (const ticker of tickers) {
    const key = `${ticker.exchange}:${ticker.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ticker);
  }
  return result;
}

function accesswireFetchHeaders(kind, feed) {
  const referer = feed?.industry
    ? `${ACCESSWIRE_BASE_URL}/newsroom/industry/${slugifyIndustry(feed.industry)}`
    : `${ACCESSWIRE_BASE_URL}/newsroom`;
  return {
    Accept: kind === "api" ? "application/json, text/javascript, */*; q=0.01" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": kind === "api" ? "application/json; charset=UTF-8" : "text/html; charset=utf-8",
    Origin: ACCESSWIRE_BASE_URL,
    Referer: referer,
    "User-Agent":
      kind === "api"
        ? "US-Stock-Radar/0.1 Access Newswire raw parser"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    account: "1",
  };
}

function accesswireRssHeaders() {
  return {
    Accept: "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  };
}

function readMetaContent(html, name) {
  if (!html || !name) return null;
  const escapedName = escapeRegExp(name);
  const patterns = [
    new RegExp(`<meta\\b(?=[^>]*(?:name|property)=(["'])${escapedName}\\1)(?=[^>]*content=(["'])(.*?)\\2)[^>]*>`, "i"),
    new RegExp(`<meta\\b(?=[^>]*content=(["'])(.*?)\\1)(?=[^>]*(?:name|property)=(["'])${escapedName}\\3)[^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return decodeHtml(match[3] || match[2] || "").trim() || null;
  }
  return null;
}

function readTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return match ? decodeHtml(match[1]).trim() : null;
}

function readCanonicalUrl(html) {
  const match = /<link\b(?=[^>]*rel=(["'])canonical\1)(?=[^>]*href=(["'])(.*?)\2)[^>]*>/i.exec(html || "");
  return match ? normalizeAccesswireUrl(match[3]) : null;
}

function readHeaderDate(html) {
  const text = textFromHtml(html || "") || "";
  return text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+(?:ET|EDT|EST)\b/i)?.[0] || null;
}

function readTopicFromHeader(html) {
  const text = textFromHtml(html || "") || "";
  return text.match(/\b(?:Topic|Category)\s*[:\-]\s*([A-Za-z &/,-]{3,80})/i)?.[1]?.trim() || null;
}

function readSourceCompanyFromBody(bodyHtml) {
  const text = textFromHtml(bodyHtml || "") || "";
  return text.match(/\b(?:SOURCE|Company)\s*[:\-]\s*([A-Za-z0-9 .,&'()-]{2,120})/i)?.[1]?.trim() || null;
}

function readIndustryFromUrl(url) {
  const decoded = decodeURIComponent(String(url || "").replace(/[-_]/g, " "));
  const match = decoded.match(/newsroom\/en\/([^/]+)/i);
  return match ? titleCase(match[1].replace(/\band\b/g, "&")) : null;
}

function buildCandidateClassificationText(description, bodyText) {
  return [description, bodyText].filter(Boolean).join("\n").slice(0, 4000);
}

function parseAccesswireDate(value) {
  const text = readString(value);
  if (!text) return null;
  const normalized = decodeHtml(text)
    .replace(/\bEDT\b/g, "GMT-0400")
    .replace(/\bEST\b/g, "GMT-0500")
    .replace(/\bET\b/g, "GMT-0500");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isEnglishAccesswireItem(item) {
  const text = [item.title, item.raw_payload.description, item.raw_payload.company_name].filter(Boolean).join(" ");
  if (!text) return true;
  const nonLatin = (text.match(/[^\u0000-\u024F\s\d.,:;'"!?()&/%$#@+\-]/g) || []).length;
  return nonLatin / Math.max(text.length, 1) < 0.2;
}

function looksLikeCloudflareChallenge(text) {
  return /\bJust a moment\b/i.test(text || "") && /\bCloudflare\b|\bchallenge-platform\b/i.test(text || "");
}

function normalizeAccesswireUrl(value) {
  if (!value) return null;
  try {
    const decoded = decodeHtml(value).trim();
    if (!decoded) return null;
    const url = new URL(decoded, ACCESSWIRE_BASE_URL);
    if (!/^(?:www\.)?accessnewswire\.com$/i.test(url.hostname)) return null;
    url.protocol = "https:";
    url.hostname = "www.accessnewswire.com";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSourceUniqueId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return readReleaseId(text) || text;
}

function readReleaseId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(decodeHtml(url), ACCESSWIRE_BASE_URL);
    const id = parsed.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    // Fall through to path match.
  }
  return String(url).match(/-(\d+)(?:\?|#|$)/i)?.[1] || null;
}

function buildDedupeKey(sourceUniqueId, sourceUrl) {
  return `accesswire:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function accesswireFeed(label, industry, primary = false) {
  const url = new URL(ACCESSWIRE_NEWSROOM_API_URL);
  if (industry) url.searchParams.set("articleindustry", industry);
  return {
    label,
    url: url.toString(),
    primary,
    industry: industry || null,
    topic: null,
  };
}

function slugifyIndustry(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function firstNonZeroStatus(feedStats) {
  return feedStats.find((feed) => Number(feed.status) > 0)?.status || 0;
}

function dateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFirstString(value) {
  if (typeof value === "string") return readString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readString(item);
      if (text) return text;
      const name = readString(readRecord(item)?.name) || readString(readRecord(item)?.title);
      if (name) return name;
    }
  }
  return null;
}

function readXmlTag(xml, tagName) {
  const match = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i").exec(
    xml || "",
  );
  if (!match) return null;
  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function normalizeExchange(exchange) {
  return decodeHtml(exchange)
    .replace(/\s+/g, " ")
    .replace(/^Nasdaq$/i, "NASDAQ")
    .replace(/^NYSEAMERICAN$/i, "NYSE American")
    .replace(/^NYSE Texas$/i, "NYSE")
    .replace(/^Cboe$/i, "CBOE")
    .replace(/^OTC PINK$/i, "OTC Pink")
    .trim();
}

function isUsExchange(exchange) {
  return /^(NASDAQ|NYSE|NYSE American|NYSE Arca|AMEX|CBOE|OTC|OTCQB|OTCQX|OTC Pink|OTC Markets)$/i.test(exchange);
}

function normalizeFilterText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clampNumber(value, min, max, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function baseDirectArticleDiagnostics(status, error) {
  return {
    feedCount: 0,
    parsedFromFeeds: status === 200 ? 1 : 0,
    articleBodiesRequested: 1,
    articleBodiesFetched: status === 200 ? 1 : 0,
    parserVersion: PARSER_VERSION,
    skippedNonEnglish: 0,
    feedStats: [
      {
        label: "Direct Access Newswire article URL",
        ok: status === 200,
        status,
        itemCount: status === 200 ? 1 : 0,
        error,
      },
    ],
  };
}
