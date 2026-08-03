import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import {
  buildSitemapWithDynamicLoader,
  collectPaginatedRows,
  type DynamicSitemapRows,
  type SitemapRow,
} from "@/lib/seoSitemapCore";

const sitemapReadLimit = 50_000;
const sitemapPageSize = 1_000;
const loadCachedDynamicSitemapRows = unstable_cache(
  loadDynamicSitemapRows,
  ["public-seo-sitemap-rows-v2"],
  { revalidate: 900 },
);

export function loadPublicSitemap() {
  return buildSitemapWithDynamicLoader(loadCachedDynamicSitemapRows);
}

async function loadDynamicSitemapRows(): Promise<DynamicSitemapRows> {
  const [events, analyses, tickers] = await Promise.all([
    loadPaginatedTable("events", {
      select:
        "id,source_group,source_code,source_name,published_at,ticker,title,quick_take,summary,delivery_level,detected_at,metadata",
      order: "detected_at.desc",
    }),
    loadPaginatedTable("event_analysis", {
      select:
        "event_id,analysis_scope,why_it_matters,bullish_points,bearish_points,key_evidence,watch_next,updated_at,metadata",
      order: "updated_at.desc",
    }),
    loadPaginatedTable("tickers", {
      select: "symbol,name,asset_type,is_active,created_at,updated_at",
      is_active: "eq.true",
      order: "symbol.asc",
    }),
  ]);

  return { analyses, events, tickers };
}

function loadPaginatedTable(
  table: string,
  search: Record<string, string>,
) {
  return collectPaginatedRows(
    async (offset, limit) => {
      const result = await supabaseSelect(table, {
        ...search,
        limit: String(limit),
        offset: String(offset),
      });
      if (!result.ok) throw new Error("Dynamic sitemap data is unavailable.");
      return toRows(result.data);
    },
    { maxRows: sitemapReadLimit, pageSize: sitemapPageSize },
  );
}

function toRows(value: unknown): SitemapRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is SitemapRow =>
          Boolean(row && typeof row === "object" && !Array.isArray(row)),
      )
    : [];
}
