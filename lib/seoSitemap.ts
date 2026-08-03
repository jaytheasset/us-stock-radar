import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import {
  buildSitemapWithDynamicLoader,
  type DynamicSitemapRows,
  type SitemapRow,
} from "@/lib/seoSitemapCore";

const sitemapReadLimit = "50000";
const loadCachedDynamicSitemapRows = unstable_cache(
  loadDynamicSitemapRows,
  ["public-seo-sitemap-rows"],
  { revalidate: 900 },
);

export function loadPublicSitemap() {
  return buildSitemapWithDynamicLoader(loadCachedDynamicSitemapRows);
}

async function loadDynamicSitemapRows(): Promise<DynamicSitemapRows> {
  const [eventsResult, analysesResult, tickersResult] = await Promise.all([
    supabaseSelect("events", {
      select:
        "id,source_group,source_code,source_name,published_at,ticker,title,quick_take,summary,delivery_level,detected_at,metadata",
      order: "detected_at.desc",
      limit: sitemapReadLimit,
    }),
    supabaseSelect("event_analysis", {
      select:
        "event_id,analysis_scope,why_it_matters,bullish_points,bearish_points,key_evidence,watch_next,updated_at,metadata",
      order: "updated_at.desc",
      limit: sitemapReadLimit,
    }),
    supabaseSelect("tickers", {
      select: "symbol,name,asset_type,is_active,created_at,updated_at",
      is_active: "eq.true",
      order: "symbol.asc",
      limit: sitemapReadLimit,
    }),
  ]);

  if (!eventsResult.ok || !analysesResult.ok || !tickersResult.ok) {
    throw new Error("Dynamic sitemap data is unavailable.");
  }

  return {
    analyses: toRows(analysesResult.data),
    events: toRows(eventsResult.data),
    tickers: toRows(tickersResult.data),
  };
}

function toRows(value: unknown): SitemapRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is SitemapRow =>
          Boolean(row && typeof row === "object" && !Array.isArray(row)),
      )
    : [];
}
