import "server-only";

import type {
  DetailTone,
  SectorThemeContext,
  SectorThemePeriod,
} from "@/app/events/[id]/detailTypes";
import {
  ANALYSIS_PEER_LIMIT,
  normalizeAnalysisTicker,
  selectAnalysisPeers,
  type AnalysisPeerCandidate,
  type AnalysisPeerFillerBucket,
  type AnalysisPeerFillerBuckets,
} from "@/lib/analysisPeerSelection";
import { supabaseSelect } from "@/lib/supabase";
import {
  resolveCanonicalMarketGroup,
  themeGroups,
  themeSubThemes,
} from "@/lib/taxonomyRegistry";

type Row = Record<string, unknown>;

const directRelatedRoles = new Set([
  "counterparty",
  "customer",
  "mentioned",
  "peer",
  "related",
  "supplier",
]);

export async function resolveAnalysisMarketContext({
  baseContext,
  companyName,
  eventTickerRows,
  exchange,
  primaryTicker,
  score,
  signal,
}: {
  baseContext: SectorThemeContext | null | undefined;
  companyName?: string;
  eventTickerRows: Row[];
  exchange?: string;
  primaryTicker: string;
  score: number;
  signal: DetailTone;
}): Promise<SectorThemeContext> {
  const primarySymbol = normalizeAnalysisTicker(primaryTicker);
  const primaryCatalog = primarySymbol
    ? (await loadTickerCatalog([primarySymbol])).get(primarySymbol)
    : undefined;
  const classification = resolveContextClassification(baseContext, primaryCatalog);
  const related = eventTickerRows
    .filter((row) => directRelatedRoles.has(stringValue(row.role).toLowerCase()))
    .map((row) => eventTickerCandidate(row, "related"))
    .filter((candidate): candidate is AnalysisPeerCandidate => Boolean(candidate));
  const legacyFillers = legacyEventTickerFillers(eventTickerRows);
  const taxonomyFillers = await loadTaxonomyFillers(classification);
  const fillerBuckets = mergeFillerBuckets(legacyFillers, taxonomyFillers);
  const selected = selectAnalysisPeers({
    fillerBuckets,
    primaryTicker: primarySymbol,
    related,
  });
  const selectedCatalog = await loadTickerCatalog(selected.map((peer) => peer.symbol));
  const peers = selected.map((peer) => {
    const catalog = selectedCatalog.get(peer.symbol);
    return {
      ...peer,
      companyName: peer.companyName || stringValue(catalog?.name) || undefined,
      exchange: peer.exchange || stringValue(catalog?.exchange) || undefined,
    };
  });
  const relatedCount = peers.filter((peer) => peer.source === "related").length;
  const fillerCount = peers.length - relatedCount;
  const periods = buildContextPeriods(baseContext, peers, score, signal);
  const resolvedCompanyName =
    cleanValue(companyName) ||
    cleanValue(baseContext?.companyName) ||
    cleanValue(primaryCatalog?.name);
  const resolvedExchange =
    cleanValue(exchange) ||
    cleanValue(baseContext?.exchange) ||
    cleanValue(primaryCatalog?.exchange);

  return {
    ...(baseContext || {}),
    companyName: resolvedCompanyName || undefined,
    contextTitle:
      cleanValue(baseContext?.contextTitle) ||
      resolvedCompanyName ||
      primarySymbol ||
      classification.subTheme ||
      classification.themeGroup ||
      classification.industry ||
      classification.sector ||
      undefined,
    exchange: resolvedExchange || undefined,
    industry: classification.industry || undefined,
    moverGroupName: buildMoverGroupName({
      baseContext,
      fillerCount,
      relatedCount,
      classification,
    }),
    moverMode: relatedCount ? "related" : "top_movers",
    periods,
    sector: classification.sector || undefined,
    subTheme: classification.subTheme || undefined,
    themeGroup: classification.themeGroup || undefined,
  };
}

function buildContextPeriods(
  baseContext: SectorThemeContext | null | undefined,
  peers: AnalysisPeerCandidate[],
  score: number,
  signal: DetailTone,
): SectorThemeContext["periods"] {
  const build = (range: keyof SectorThemeContext["periods"]): SectorThemePeriod => {
    const stored = baseContext?.periods?.[range];
    return {
      ...(stored || {}),
      themeScore: stored?.themeScore ?? score,
      themeSignal: stored?.themeSignal || signal,
      topMovers: peers.map((peer) => ({
        companyName: peer.companyName,
        exchange: peer.exchange,
        fillerBucket: peer.fillerBucket,
        source: peer.source,
        symbol: peer.symbol,
      })),
    };
  };

  return {
    "1D": build("1D"),
    "5D": build("5D"),
    "30D": build("30D"),
  };
}

function resolveContextClassification(
  context: SectorThemeContext | null | undefined,
  ticker: Row | undefined,
) {
  return {
    industry: cleanValue(context?.industry) || cleanValue(ticker?.fmp_industry),
    sector: cleanValue(context?.sector) || cleanValue(ticker?.fmp_sector),
    subTheme: cleanValue(context?.subTheme),
    themeGroup: cleanValue(context?.themeGroup),
  };
}

function eventTickerCandidate(
  row: Row,
  source: AnalysisPeerCandidate["source"],
  fillerBucket?: AnalysisPeerFillerBucket,
): AnalysisPeerCandidate | null {
  const symbol = normalizeAnalysisTicker(stringValue(row.symbol));
  if (!symbol) return null;
  const metadata = recordValue(row.metadata);
  return {
    companyName:
      cleanValue(metadata?.company_name) ||
      cleanValue(metadata?.company) ||
      cleanValue(metadata?.name) ||
      undefined,
    exchange: cleanValue(row.exchange) || undefined,
    ...(fillerBucket ? { fillerBucket } : {}),
    relevanceScore: finiteNumber(row.relevance_score),
    role: cleanValue(row.role) || undefined,
    sortOrder: finiteNumber(row.sort_order),
    source,
    symbol,
  };
}

function legacyEventTickerFillers(rows: Row[]): AnalysisPeerFillerBuckets {
  const theme = rows
    .filter((row) => stringValue(row.role).toLowerCase() === "theme_constituent")
    .map((row) => eventTickerCandidate(row, "filler", "theme"))
    .filter((candidate): candidate is AnalysisPeerCandidate => Boolean(candidate));
  const sector = rows
    .filter((row) => stringValue(row.role).toLowerCase() === "sector_constituent")
    .map((row) => eventTickerCandidate(row, "filler", "sector"))
    .filter((candidate): candidate is AnalysisPeerCandidate => Boolean(candidate));
  return { sector, theme };
}

async function loadTaxonomyFillers(classification: {
  industry: string;
  sector: string;
  subTheme: string;
  themeGroup: string;
}): Promise<AnalysisPeerFillerBuckets> {
  const [themeFillers, classificationFillers] = await Promise.all([
    loadThemeFillers(classification.subTheme, classification.themeGroup),
    loadClassificationFillers(classification.industry, classification.sector),
  ]);
  return {
    ...classificationFillers,
    ...themeFillers,
  };
}

async function loadThemeFillers(
  subThemeValue: string,
  themeGroupValue: string,
): Promise<AnalysisPeerFillerBuckets> {
  const normalizedSubTheme = normalizeLabel(subThemeValue);
  const normalizedThemeGroup = normalizeLabel(themeGroupValue);
  const matchedSubTheme = normalizedSubTheme
    ? themeSubThemes.find((item) =>
        [item.slug, item.name, ...item.keywords].some((value) =>
          labelsMatch(normalizedSubTheme, normalizeLabel(value)),
        ),
      )
    : undefined;
  const matchedThemeGroup = themeGroups.find((group) =>
    [group.slug, group.name].some((value) =>
      labelsMatch(normalizedThemeGroup, normalizeLabel(value)),
    ),
  );
  const groupSlug = matchedSubTheme?.themeGroupSlug || matchedThemeGroup?.slug || "";
  const groupThemes = groupSlug
    ? themeSubThemes.filter((item) => item.themeGroupSlug === groupSlug)
    : [];
  const subThemeSymbols = matchedSubTheme?.seedSymbols || [];
  const memberSymbols = groupSlug ? await readThemeMemberSymbols(groupSlug) : [];
  const themeSymbols = uniqueSymbols([
    ...memberSymbols,
    ...groupThemes.flatMap((item) => item.seedSymbols),
  ]).filter((symbol) => !subThemeSymbols.includes(symbol));
  const catalog = await loadTickerCatalog([
    ...subThemeSymbols,
    ...themeSymbols,
  ]);

  return {
    sub_theme: candidatesFromCatalog(subThemeSymbols, catalog, "sub_theme"),
    theme: candidatesFromCatalog(themeSymbols, catalog, "theme"),
  };
}

async function readThemeMemberSymbols(groupSlug: string) {
  const result = await supabaseSelect("ticker_theme_members", {
    select: "symbol,confidence,updated_at",
    theme_group_slug: `eq.${groupSlug}`,
    order: "confidence.desc,updated_at.desc",
    limit: "200",
  });
  return toRows(result.data).map((row) => stringValue(row.symbol));
}

async function loadClassificationFillers(
  industryValue: string,
  sectorValue: string,
): Promise<AnalysisPeerFillerBuckets> {
  const industryMatch = resolveCanonicalMarketGroup(industryValue);
  const sectorMatch = resolveCanonicalMarketGroup(
    sectorValue || industryMatch?.sector || "",
  );
  const sectorCode = sectorCodeFromName(
    sectorMatch?.sector || industryMatch?.sector || sectorValue,
  );
  const industrySlug = industryMatch?.slug || "";
  const [industryRows, sectorRows] = await Promise.all([
    industrySlug
      ? readClassificationRows({
          sectorCode,
          subCategorySlug: industrySlug,
        })
      : Promise.resolve([]),
    sectorCode
      ? readClassificationRows({ sectorCode })
      : Promise.resolve([]),
  ]);
  const symbols = uniqueSymbols([
    ...industryRows.map((row) => stringValue(row.symbol)),
    ...sectorRows.map((row) => stringValue(row.symbol)),
  ]);
  const catalog = await loadTickerCatalog(symbols);
  const industrySymbols = industryRows.map((row) => stringValue(row.symbol));
  const sectorSymbols = sectorRows
    .map((row) => stringValue(row.symbol))
    .filter((symbol) => !industrySymbols.includes(symbol));

  return {
    industry_group: candidatesFromCatalog(
      industrySymbols,
      catalog,
      "industry_group",
    ),
    sector: candidatesFromCatalog(sectorSymbols, catalog, "sector"),
  };
}

async function readClassificationRows({
  sectorCode,
  subCategorySlug,
}: {
  sectorCode: string;
  subCategorySlug?: string;
}) {
  const query: Record<string, string> = {
    limit: "300",
    order: "confidence.desc,updated_at.desc",
    sector_code: `eq.${sectorCode}`,
    select: "symbol,sector_code,sub_category_slug,confidence,updated_at",
  };
  if (subCategorySlug) {
    query.sub_category_slug = `eq.${subCategorySlug}`;
  }
  const result = await supabaseSelect("ticker_classifications", query);
  return toRows(result.data);
}

async function loadTickerCatalog(symbolInputs: string[]) {
  const symbols = uniqueSymbols(symbolInputs);
  if (!symbols.length) return new Map<string, Row>();
  const result = await supabaseSelect("tickers", {
    asset_type: "in.(stock,adr_or_class)",
    is_active: "eq.true",
    limit: String(Math.max(symbols.length, 1)),
    select:
      "symbol,name,exchange,fmp_sector,fmp_industry,asset_type,market_cap,is_active",
    symbol: postgrestIn(symbols),
  });
  return new Map(
    toRows(result.data).flatMap((row) => {
      const symbol = normalizeAnalysisTicker(stringValue(row.symbol));
      return symbol ? [[symbol, row] as const] : [];
    }),
  );
}

function candidatesFromCatalog(
  symbolInputs: string[],
  catalog: Map<string, Row>,
  fillerBucket: AnalysisPeerFillerBucket,
) {
  return uniqueSymbols(symbolInputs)
    .flatMap((symbol) => {
      const row = catalog.get(symbol);
      if (!row) return [];
      return [
        {
          companyName: cleanValue(row.name) || undefined,
          exchange: cleanValue(row.exchange) || undefined,
          fillerBucket,
          source: "filler" as const,
          symbol,
        },
      ];
    })
    .sort((left, right) => {
      const marketCapDifference =
        marketCap(catalog.get(right.symbol)) - marketCap(catalog.get(left.symbol));
      return marketCapDifference || left.symbol.localeCompare(right.symbol);
    });
}

function mergeFillerBuckets(
  first: AnalysisPeerFillerBuckets,
  second: AnalysisPeerFillerBuckets,
): AnalysisPeerFillerBuckets {
  return {
    industry_group: [
      ...(first.industry_group || []),
      ...(second.industry_group || []),
    ],
    sector: [...(first.sector || []), ...(second.sector || [])],
    sub_theme: [...(first.sub_theme || []), ...(second.sub_theme || [])],
    theme: [...(first.theme || []), ...(second.theme || [])],
  };
}

function buildMoverGroupName({
  baseContext,
  classification,
  fillerCount,
  relatedCount,
}: {
  baseContext: SectorThemeContext | null | undefined;
  classification: {
    industry: string;
    sector: string;
    subTheme: string;
    themeGroup: string;
  };
  fillerCount: number;
  relatedCount: number;
}) {
  const classificationName =
    classification.subTheme ||
    classification.themeGroup ||
    classification.industry ||
    classification.sector ||
    cleanValue(baseContext?.moverGroupName);
  if (relatedCount && fillerCount) {
    return classificationName
      ? `Directly related + ${classificationName} peers`
      : "Directly related + taxonomy peers";
  }
  if (relatedCount) return "Directly related tickers";
  return classificationName || "Taxonomy peers";
}

function sectorCodeFromName(value: string) {
  const normalized = normalizeLabel(value);
  const aliases: Record<string, string> = {
    basicmaterials: "basic_materials",
    communicationservices: "communication_services",
    consumercyclical: "consumer_cyclical",
    consumerdefensive: "consumer_defensive",
    consumerdiscretionary: "consumer_cyclical",
    consumerstaples: "consumer_defensive",
    energy: "energy",
    financials: "financial_services",
    financialservices: "financial_services",
    healthcare: "healthcare",
    industrials: "industrials",
    materials: "basic_materials",
    realestate: "real_estate",
    technology: "technology",
    utilities: "utilities",
  };
  return aliases[normalized] || "";
}

function labelsMatch(value: string, candidate: string) {
  if (!value || !candidate) return false;
  return value === candidate || value.includes(candidate) || candidate.includes(value);
}

function normalizeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function postgrestIn(values: string[]) {
  return `in.(${values.join(",")})`;
}

function uniqueSymbols(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeAnalysisTicker).filter(Boolean)),
  ).slice(0, 400);
}

function marketCap(row: Row | undefined) {
  return finiteNumber(row?.market_cap) ?? 0;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cleanValue(value: unknown) {
  const text = stringValue(value);
  return text && !["N/A", "NA", "UNKNOWN"].includes(text.toUpperCase())
    ? text
    : "";
}

function recordValue(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function toRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row): row is Row => Boolean(recordValue(row)))
    : [];
}

export const analysisPeerLimit = ANALYSIS_PEER_LIMIT;
