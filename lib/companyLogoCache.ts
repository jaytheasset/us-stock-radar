import { fetchPolygonTicker } from "@/lib/integrations";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";

const READY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 15 * 60 * 1000;
const COMPANY_LOGO_CACHE_TABLE = "company_logo_cache";

const logoRequests = new Map<string, Promise<CompanyLogoSource | null>>();

type CompanyLogoCacheStatus = "ready" | "missing" | "error";

type CompanyLogoCacheRow = {
  expires_at?: unknown;
  icon_url?: unknown;
  logo_url?: unknown;
  status?: unknown;
};

type PolygonTickerDetails = {
  branding?: {
    icon_url?: unknown;
    logo_url?: unknown;
  };
};

export type CompanyLogoSource = {
  iconUrl: string | null;
  logoUrl: string | null;
  symbol: string;
};

export function normalizeCompanyLogoSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  if (
    !symbol ||
    symbol === "N/A" ||
    symbol === "MARKET" ||
    !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)
  ) {
    return null;
  }

  return symbol;
}

export function companyLogoPath(value: string) {
  const symbol = normalizeCompanyLogoSymbol(value);
  return symbol ? `/api/market/logo/${encodeURIComponent(symbol)}` : undefined;
}

export async function resolveCompanyLogoSource(value: string) {
  const symbol = normalizeCompanyLogoSymbol(value);
  if (!symbol) return null;

  const cached = await readCachedLogo(symbol);
  if (cached.fresh) return cached.source;

  const pending = logoRequests.get(symbol);
  if (pending) return pending;

  const request = refreshCompanyLogoSource(symbol).finally(() => {
    logoRequests.delete(symbol);
  });
  logoRequests.set(symbol, request);
  return request;
}

async function readCachedLogo(symbol: string): Promise<{
  fresh: boolean;
  source: CompanyLogoSource | null;
}> {
  const result = await supabaseSelect(COMPANY_LOGO_CACHE_TABLE, {
    select: "symbol,status,logo_url,icon_url,expires_at",
    symbol: `eq.${symbol}`,
    limit: "1",
  });

  const row =
    result.ok && Array.isArray(result.data)
      ? (result.data[0] as CompanyLogoCacheRow | undefined)
      : undefined;
  if (!row) return { fresh: false, source: null };

  const expiresAt = Date.parse(stringValue(row.expires_at));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { fresh: false, source: null };
  }

  if (row.status !== "ready") {
    return { fresh: true, source: null };
  }

  const logoUrl = safeProviderAssetUrl(row.logo_url);
  const iconUrl = safeProviderAssetUrl(row.icon_url);
  if (!logoUrl && !iconUrl) return { fresh: false, source: null };

  return {
    fresh: true,
    source: { iconUrl, logoUrl, symbol },
  };
}

async function refreshCompanyLogoSource(symbol: string) {
  const providerResult = await fetchPolygonTicker(symbol);
  if (!providerResult.ok) {
    await writeCache(symbol, "error", null, null, ERROR_TTL_MS, {
      provider_status: providerResult.status,
    });
    return null;
  }

  const details = asTickerDetails(providerResult.data);
  const logoUrl = safeProviderAssetUrl(details?.branding?.logo_url);
  const iconUrl = safeProviderAssetUrl(details?.branding?.icon_url);

  if (!logoUrl && !iconUrl) {
    await writeCache(symbol, "missing", null, null, MISSING_TTL_MS, {
      branding_available: false,
    });
    return null;
  }

  await writeCache(symbol, "ready", logoUrl, iconUrl, READY_TTL_MS, {
    branding_available: true,
  });
  return { iconUrl, logoUrl, symbol };
}

async function writeCache(
  symbol: string,
  status: CompanyLogoCacheStatus,
  logoUrl: string | null,
  iconUrl: string | null,
  ttlMs: number,
  rawPayload: Record<string, unknown>,
) {
  const fetchedAt = new Date();
  await supabaseUpsert(
    COMPANY_LOGO_CACHE_TABLE,
    {
      symbol,
      provider: "polygon",
      status,
      logo_url: logoUrl,
      icon_url: iconUrl,
      fetched_at: fetchedAt.toISOString(),
      expires_at: new Date(fetchedAt.getTime() + ttlMs).toISOString(),
      last_error: status === "error" ? "Provider request failed" : null,
      raw_payload: rawPayload,
    },
    { onConflict: "symbol" },
  );
}

function asTickerDetails(value: unknown): PolygonTickerDetails | null {
  return value && typeof value === "object"
    ? (value as PolygonTickerDetails)
    : null;
}

function safeProviderAssetUrl(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;

  try {
    const url = new URL(text);
    const allowedHost =
      url.hostname === "api.polygon.io" ||
      url.hostname === "api.massive.com";
    return url.protocol === "https:" && allowedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
