import { getServerEnv } from "@/lib/env";
import {
  normalizeCompanyLogoSymbol,
  resolveCompanyLogoSource,
} from "@/lib/companyLogoCache";

export const dynamic = "force-dynamic";

const IMAGE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
};

const MISSING_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900, s-maxage=3600",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker: tickerParam } = await context.params;
  const symbol = normalizeCompanyLogoSymbol(decodeURIComponent(tickerParam));
  if (!symbol) {
    return new Response(null, { status: 404, headers: MISSING_CACHE_HEADERS });
  }

  const source = await resolveCompanyLogoSource(symbol);
  const sourceUrl = source?.logoUrl || source?.iconUrl;
  if (!sourceUrl) {
    return new Response(null, { status: 404, headers: MISSING_CACHE_HEADERS });
  }

  const apiKey = getServerEnv().polygonApiKey;
  if (!apiKey) {
    return new Response(null, { status: 503 });
  }

  const providerUrl = new URL(sourceUrl);
  providerUrl.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(providerUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
      return new Response(null, {
        status: response.status === 404 ? 404 : 502,
        headers: MISSING_CACHE_HEADERS,
      });
    }

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        ...IMAGE_CACHE_HEADERS,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: MISSING_CACHE_HEADERS });
  }
}
