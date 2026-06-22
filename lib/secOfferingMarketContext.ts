import { fetchFmpProfile, fetchFmpQuote, fetchFmpSharesFloat } from "@/lib/integrations";
import { supabaseSelect } from "@/lib/supabase";
import { resolveCanonicalMarketGroup } from "@/lib/taxonomyRegistry";

type PersistedRow = Record<string, unknown>;

type NumberCandidate = {
  value: unknown;
  source: string;
  asOf?: string | null;
};

export type SecOfferingMarketContext = {
  symbol: string | null;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  industry_group: string | null;
  sub_category: string | null;
  sub_category_slug: string | null;
  fmp_sector: string | null;
  fmp_industry: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  available: boolean;
  data_quality: "complete" | "partial" | "missing";
  as_of: string | null;
  price: number | null;
  previous_close: number | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  public_float: number | null;
  public_float_percent: number | null;
  volume: number | null;
  avg_volume: number | null;
  field_sources: Record<string, string | null>;
  source_priority: string[];
  errors: string[];
};

export type SecOfferingDilutionMetrics = {
  available: boolean;
  shares_offered: number | null;
  shares_offered_source: string | null;
  current_shares_outstanding: number | null;
  current_shares_outstanding_source: string | null;
  public_float: number | null;
  public_float_source: string | null;
  market_cap: number | null;
  market_cap_source: string | null;
  market_reference_price: number | null;
  market_reference_price_source: string | null;
  offering_amount: number | null;
  offering_amount_source: string | null;
  offering_price: number | null;
  offering_price_source: string | null;
  estimated_dilution_percent: number | null;
  float_overhang_percent: number | null;
  offering_amount_percent_of_market_cap: number | null;
  discount_to_market_percent: number | null;
  max_share_impact_percent: number | null;
  dilution_scale: "unknown" | "low" | "moderate" | "elevated" | "high" | "severe";
  preliminary_score_floor: number | null;
  preliminary_score_cap: number | null;
  delivery_hint: "skip" | "archive" | "feed" | "alert" | "urgent" | null;
  score_policy_reasons: string[];
  calculation_notes: string[];
};

export async function resolveSecOfferingMarketContext(symbolInput: string): Promise<SecOfferingMarketContext> {
  const symbol = normalizeSymbol(symbolInput);
  const liveAsOf = new Date().toISOString();
  const errors: string[] = [];

  if (!symbol) {
    return buildMissingMarketContext(null, ["missing_symbol"]);
  }

  const [snapshotResult, quoteCacheResult, tickerResult, fmpQuoteResult, fmpProfileResult, fmpFloatResult] =
    await Promise.all([
      readLatestMarketSnapshot(symbol),
      readMarketQuote(symbol),
      readTickerRow(symbol),
      fetchFmpQuote(symbol),
      fetchFmpProfile(symbol),
      fetchFmpSharesFloat(symbol),
    ]);

  const snapshot = snapshotResult.row;
  const quoteCache = quoteCacheResult.row;
  const ticker = tickerResult.row;
  const fmpQuote = firstRecord(fmpQuoteResult.data);
  const fmpProfile = firstRecord(fmpProfileResult.data);
  const fmpFloat = firstRecord(fmpFloatResult.data);
  const rawSector = firstString(fmpProfile?.sector, ticker?.fmp_sector);
  const rawIndustry = firstString(fmpProfile?.industry, ticker?.fmp_industry);
  const industryMatch = rawIndustry ? resolveCanonicalMarketGroup(rawIndustry) : null;
  const sectorMatch = rawSector ? resolveCanonicalMarketGroup(rawSector) : null;
  const canonicalSector = firstString(industryMatch?.sector, sectorMatch?.sector, rawSector);
  const canonicalIndustry = firstString(industryMatch?.subCategory, rawIndustry);
  const canonicalIndustrySlug = firstString(industryMatch?.slug, sectorMatch?.slug);
  const exchange = firstString(fmpProfile?.exchangeShortName, fmpProfile?.exchange, ticker?.exchange);
  const name = firstString(fmpProfile?.companyName, fmpProfile?.company_name, ticker?.name);

  for (const result of [snapshotResult, quoteCacheResult, tickerResult]) {
    if (result.error) errors.push(result.error);
  }
  for (const [label, result] of [
    ["fmp_quote", fmpQuoteResult],
    ["fmp_profile", fmpProfileResult],
    ["fmp_shares_float", fmpFloatResult],
  ] as const) {
    if (!result.ok && result.error) errors.push(`${label}: ${result.error}`);
  }

  const price = chooseNumber([
    { value: fmpQuote?.price, source: "fmp_quote", asOf: liveAsOf },
    { value: quoteCache?.price, source: "market_quotes", asOf: stringValue(quoteCache?.fetched_at) },
    { value: snapshot?.price, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);
  const previousClose = chooseNumber([
    { value: fmpQuote?.previousClose, source: "fmp_quote", asOf: liveAsOf },
    { value: quoteCache?.previous_close, source: "market_quotes", asOf: stringValue(quoteCache?.fetched_at) },
  ]);
  const marketCap = chooseNumber([
    { value: fmpQuote?.marketCap, source: "fmp_quote", asOf: liveAsOf },
    { value: fmpProfile?.mktCap, source: "fmp_profile", asOf: liveAsOf },
    { value: fmpProfile?.marketCap, source: "fmp_profile", asOf: liveAsOf },
    { value: ticker?.market_cap, source: "tickers", asOf: stringValue(ticker?.last_profiled_at) },
    { value: snapshot?.market_cap, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);
  const sharesOutstanding = chooseNumber([
    { value: fmpFloat?.outstandingShares, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.outstanding_shares, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpQuote?.sharesOutstanding, source: "fmp_quote", asOf: liveAsOf },
    { value: fmpProfile?.sharesOutstanding, source: "fmp_profile", asOf: liveAsOf },
    { value: snapshot?.shares_outstanding, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);
  const publicFloat = chooseNumber([
    { value: fmpFloat?.floatShares, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.float_shares, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.freeFloatShares, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.publicFloat, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.sharesFloat, source: "fmp_shares_float", asOf: liveAsOf },
    { value: snapshot?.float_shares, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);
  const publicFloatPercent = chooseNumber([
    { value: fmpFloat?.freeFloat, source: "fmp_shares_float", asOf: liveAsOf },
    { value: fmpFloat?.free_float, source: "fmp_shares_float", asOf: liveAsOf },
  ]);
  const volume = chooseNumber([
    { value: fmpQuote?.volume, source: "fmp_quote", asOf: liveAsOf },
    { value: quoteCache?.volume, source: "market_quotes", asOf: stringValue(quoteCache?.fetched_at) },
    { value: snapshot?.volume, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);
  const avgVolume = chooseNumber([
    { value: fmpQuote?.avgVolume, source: "fmp_quote", asOf: liveAsOf },
    { value: fmpQuote?.averageVolume, source: "fmp_quote", asOf: liveAsOf },
    { value: fmpProfile?.volAvg, source: "fmp_profile", asOf: liveAsOf },
    { value: snapshot?.avg_volume, source: "market_snapshots", asOf: stringValue(snapshot?.fetched_at) },
  ]);

  const asOf = mostRecent([price.asOf, marketCap.asOf, sharesOutstanding.asOf, publicFloat.asOf, volume.asOf]);
  const fieldSources = {
    name: name ? firstString(fmpProfile?.companyName, fmpProfile?.company_name) ? "fmp_profile" : "tickers" : null,
    exchange: exchange ? firstString(fmpProfile?.exchangeShortName, fmpProfile?.exchange) ? "fmp_profile" : "tickers" : null,
    sector: canonicalSector ? rawSector ? "fmp_profile_or_tickers" : "taxonomy" : null,
    industry: canonicalIndustry ? rawIndustry ? "fmp_profile_or_tickers" : "taxonomy" : null,
    industry_group: canonicalIndustry ? rawIndustry ? "fmp_profile_or_tickers" : "taxonomy" : null,
    sub_category: canonicalIndustry ? "taxonomy" : null,
    sub_category_slug: canonicalIndustrySlug ? "taxonomy" : null,
    price: price.source,
    previous_close: previousClose.source,
    market_cap: marketCap.source,
    shares_outstanding: sharesOutstanding.source,
    public_float: publicFloat.source,
    public_float_percent: publicFloatPercent.source,
    volume: volume.source,
    avg_volume: avgVolume.source,
  };
  const available = Boolean(
    price.value ||
      marketCap.value ||
      sharesOutstanding.value ||
      publicFloat.value ||
      volume.value,
  );
  const complete = Boolean(price.value && marketCap.value && sharesOutstanding.value && publicFloat.value);

  return {
    symbol,
    name,
    exchange,
    sector: canonicalSector || null,
    industry: canonicalIndustry || null,
    industry_group: canonicalIndustry || null,
    sub_category: canonicalIndustry || null,
    sub_category_slug: canonicalIndustrySlug || null,
    fmp_sector: rawSector || null,
    fmp_industry: rawIndustry || null,
    theme_group: null,
    sub_theme: null,
    available,
    data_quality: complete ? "complete" : available ? "partial" : "missing",
    as_of: asOf,
    price: price.value,
    previous_close: previousClose.value,
    market_cap: marketCap.value,
    shares_outstanding: sharesOutstanding.value,
    public_float: publicFloat.value,
    public_float_percent: publicFloatPercent.value,
    volume: volume.value,
    avg_volume: avgVolume.value,
    field_sources: fieldSources,
    source_priority: ["fmp_shares_float", "fmp_quote", "fmp_profile", "market_quotes", "tickers", "market_snapshots"],
    errors: errors.slice(0, 6),
  };
}

export function buildSecOfferingDilutionMetrics(
  filingPackage: Record<string, unknown>,
  marketContext: SecOfferingMarketContext | null,
): SecOfferingDilutionMetrics {
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const offeringTerms = readRecord(s3?.offering_terms);
  const feeTable = readRecord(s3?.fee_table);
  const offeringAudit = readRecord(filingPackage.offering_security_audit);
  const auditSecurityStack = readRecord(offeringAudit?.security_stack);
  const auditProceedsStack = readRecord(offeringAudit?.proceeds_stack);

  const sharesOffered = chooseParsedNumber([
    { value: auditSecurityStack?.max_registered_stack_share_equivalent, source: "audit.security_stack.max_registered_stack_share_equivalent" },
    { value: auditSecurityStack?.registered_resale_supply, source: "audit.security_stack.registered_resale_supply" },
    { value: auditSecurityStack?.resale_selling_stockholder_shares, source: "audit.security_stack.resale_selling_stockholder_shares" },
    { value: auditSecurityStack?.primary_common_shares_offered, source: "audit.security_stack.primary_common_shares_offered" },
    { value: auditSecurityStack?.primary_common_shares_registered, source: "audit.security_stack.primary_common_shares_registered" },
  ], parseSupplyShareCount);
  const currentShares = chooseParsedNumber([
    { value: auditSecurityStack?.current_shares_outstanding, source: "audit.security_stack.current_shares_outstanding" },
    { value: s3?.current_shares_outstanding, source: "filing.s3.current_shares_outstanding" },
    { value: offeringTerms?.current_shares_outstanding, source: "filing.offering_terms.current_shares_outstanding" },
    { value: marketContext?.shares_outstanding, source: "market_context.shares_outstanding" },
  ], parseShareCount);
  const publicFloat = chooseParsedNumber([
    { value: auditSecurityStack?.public_float, source: "audit.security_stack.public_float" },
    { value: marketContext?.public_float, source: "market_context.public_float" },
  ], parseShareCount);
  const marketCap = chooseParsedNumber([
    { value: marketContext?.market_cap, source: "market_context.market_cap" },
  ], parseMoney);
  const marketReferencePrice = chooseParsedNumber([
    { value: marketContext?.price, source: "market_context.price" },
    { value: marketContext?.previous_close, source: "market_context.previous_close" },
  ], parseMoney);
  const offeringAmountCandidates = [
    { value: auditProceedsStack?.company_gross_proceeds, source: "audit.proceeds_stack.company_gross_proceeds" },
    { value: auditProceedsStack?.company_net_proceeds, source: "audit.proceeds_stack.company_net_proceeds" },
    { value: offeringTerms?.offering_amount, source: "filing.offering_terms.offering_amount" },
    { value: offeringTerms?.atm_program_size, source: "filing.offering_terms.atm_program_size" },
    ...(offeringAudit ? [] : [{ value: feeTable?.total_offering_amount, source: "filing.fee_table.total_offering_amount" }]),
  ];
  const offeringAmount = chooseParsedNumber(offeringAmountCandidates, parseMoney);
  const offeringPrice = chooseParsedNumber([
    { value: auditProceedsStack?.offering_price, source: "audit.proceeds_stack.offering_price" },
    { value: offeringTerms?.offering_price, source: "filing.offering_terms.offering_price" },
  ], parseMoney);

  const estimatedDilutionPercent = percent(sharesOffered.value, currentShares.value);
  const floatOverhangPercent = percent(sharesOffered.value, publicFloat.value);
  const offeringAmountPercentOfMarketCap = percent(offeringAmount.value, marketCap.value);
  const discountToMarketPercent =
    isPositiveNumber(offeringPrice.value) && isPositiveNumber(marketReferencePrice.value)
      ? roundPercent(((marketReferencePrice.value - offeringPrice.value) / marketReferencePrice.value) * 100)
      : null;
  const maxShareImpactPercent = maxNumber([estimatedDilutionPercent, floatOverhangPercent]);
  const dilutionScale = classifyDilutionScale(maxShareImpactPercent, offeringAmountPercentOfMarketCap);
  const scorePolicy = buildScorePolicy({
    filingPackage,
    s3,
    offeringTerms,
    dilutionScale,
    maxShareImpactPercent,
    offeringAmountPercentOfMarketCap,
  });
  const notes = buildCalculationNotes({
    sharesOffered: sharesOffered.value,
    currentShares: currentShares.value,
    publicFloat: publicFloat.value,
    marketCap: marketCap.value,
  });

  return {
    available: Boolean(
      sharesOffered.value ||
        currentShares.value ||
        publicFloat.value ||
        marketCap.value ||
        offeringAmount.value ||
        estimatedDilutionPercent ||
        floatOverhangPercent,
    ),
    shares_offered: sharesOffered.value,
    shares_offered_source: sharesOffered.source,
    current_shares_outstanding: currentShares.value,
    current_shares_outstanding_source: currentShares.source,
    public_float: publicFloat.value,
    public_float_source: publicFloat.source,
    market_cap: marketCap.value,
    market_cap_source: marketCap.source,
    market_reference_price: marketReferencePrice.value,
    market_reference_price_source: marketReferencePrice.source,
    offering_amount: offeringAmount.value,
    offering_amount_source: offeringAmount.source,
    offering_price: offeringPrice.value,
    offering_price_source: offeringPrice.source,
    estimated_dilution_percent: estimatedDilutionPercent,
    float_overhang_percent: floatOverhangPercent,
    offering_amount_percent_of_market_cap: offeringAmountPercentOfMarketCap,
    discount_to_market_percent: discountToMarketPercent,
    max_share_impact_percent: maxShareImpactPercent,
    dilution_scale: dilutionScale,
    preliminary_score_floor: scorePolicy.floor,
    preliminary_score_cap: scorePolicy.cap,
    delivery_hint: scorePolicy.deliveryHint,
    score_policy_reasons: scorePolicy.reasons,
    calculation_notes: notes,
  };
}

function buildMissingMarketContext(symbol: string | null, errors: string[]): SecOfferingMarketContext {
  return {
    symbol,
    name: null,
    exchange: null,
    sector: null,
    industry: null,
    industry_group: null,
    sub_category: null,
    sub_category_slug: null,
    fmp_sector: null,
    fmp_industry: null,
    theme_group: null,
    sub_theme: null,
    available: false,
    data_quality: "missing",
    as_of: null,
    price: null,
    previous_close: null,
    market_cap: null,
    shares_outstanding: null,
    public_float: null,
    public_float_percent: null,
    volume: null,
    avg_volume: null,
    field_sources: {},
    source_priority: [],
    errors,
  };
}

async function readLatestMarketSnapshot(symbol: string) {
  const result = await supabaseSelect("market_snapshots", {
    select: "ticker,price,market_cap,float_shares,shares_outstanding,volume,avg_volume,source,fetched_at",
    ticker: `eq.${symbol}`,
    order: "fetched_at.desc",
    limit: "1",
  });
  return readSingleRowResult(result, "market_snapshots");
}

async function readMarketQuote(symbol: string) {
  const result = await supabaseSelect("market_quotes", {
    select: "symbol,provider,price,previous_close,volume,fetched_at,expires_at",
    symbol: `eq.${symbol}`,
    limit: "1",
  });
  return readSingleRowResult(result, "market_quotes");
}

async function readTickerRow(symbol: string) {
  const result = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,market_cap,fmp_sector,fmp_industry,last_profiled_at",
    symbol: `eq.${symbol}`,
    limit: "1",
  });
  return readSingleRowResult(result, "tickers");
}

function readSingleRowResult(result: { ok: boolean; error?: string; data?: unknown }, source: string) {
  return {
    row: result.ok && Array.isArray(result.data) ? readRecord(result.data[0]) : null,
    error: result.ok ? null : `${source}: ${result.error || "read_failed"}`,
  };
}

function chooseNumber(candidates: NumberCandidate[]) {
  for (const candidate of candidates) {
    const value = finiteNumber(candidate.value);
    if (value !== null) {
      return {
        value,
        source: candidate.source,
        asOf: candidate.asOf || null,
      };
    }
  }
  return { value: null, source: null, asOf: null };
}

function chooseParsedNumber(
  candidates: Array<{ value: unknown; source: string }>,
  parser: (value: unknown) => number | null,
) {
  for (const candidate of candidates) {
    const value = parser(candidate.value);
    if (value !== null && Number.isFinite(value)) return { value, source: candidate.source };
  }
  return { value: null, source: null };
}

function parseShareCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const record = readRecord(value);
  if (record) {
    const unit = stringValue(record.unit).toLowerCase();
    const relationship = stringValue(record.relationship).toLowerCase();
    const valueText = stringValue(record.value_text || record.text || record.value).toLowerCase();
    if (unit && unit !== "shares" && !/\bshares?\b/.test(valueText)) return null;
    if (/\b(?:usd|company_cash|selling_holder_cash|fee_table_only)\b/.test(`${unit} ${relationship}`)) return null;
    return (
      parseShareCount(record.numeric_value) ??
      parseShareCount(record.value_text) ??
      parseShareCount(record.value) ??
      parseShareCount(record.count) ??
      parseShareCount(record.text)
    );
  }

  const text = stringValue(value).toLowerCase();
  if (!text) return null;
  const match = text.match(/(\d[\d,.]*)\s*(thousand|million|billion|m|bn|k)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const scale = match[2]?.toLowerCase();
  if (scale === "thousand" || scale === "k") return base * 1_000;
  if (scale === "million" || scale === "m") return base * 1_000_000;
  if (scale === "billion" || scale === "bn") return base * 1_000_000_000;
  return base;
}

function parseSupplyShareCount(value: unknown): number | null {
  if (isNonSupplyShareCandidate(value)) return null;
  return parseShareCount(value);
}

function isNonSupplyShareCandidate(value: unknown) {
  const record = readRecord(value);
  if (!record) {
    const text = stringValue(value).toLowerCase();
    return isNonSupplyShareText(text);
  }

  const relationshipText = [
    record.label,
    record.relationship,
    record.unit,
  ]
    .map((item) => stringValue(item).toLowerCase())
    .join(" ");
  if (/\b(?:current|outstanding|public\s+float|authorized)\b/.test(relationshipText)) return true;

  const evidenceText = [
    record.value_text,
    record.text,
    record.value,
    record.evidence,
  ]
    .map((item) => stringValue(item).toLowerCase())
    .join(" ");
  return isNonSupplyShareText(evidenceText);
}

function isNonSupplyShareText(text: string) {
  if (!text) return false;
  if (/\b(?:authorized\s+(?:capital\s+stock|shares?|preferred\s+stock)|we\s+are\s+authorized\s+to\s+issue|capital\s+stock\s+consists|description\s+of\s+capital\s+stock|blank\s+check\s+preferred|undesignated\s+preferred|calculated\s+solely|public\s+float|maximum\s+aggregate\s+offering\s+price|registration\s+fee|fee\s+rate)\b/i.test(text)) {
    return true;
  }
  const denominatorOnly =
    /\b(?:issued\s+and\s+outstanding|shares?\s+outstanding|beneficially\s+owned|owned\s+prior|owned\s+before|owned\s+after|post-offering|after\s+this\s+offering)\b/i.test(
      text,
    );
  const hasSupplySignal =
    /\b(?:registered|registering|offered|offer(?:ing)?|resale|sell|sale|issuable|underlying|conversion|convertible|warrant|pre-funded|common\s+stock)\b/i.test(
      text,
    );
  return denominatorOnly && !hasSupplySignal;
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const record = readRecord(value);
  if (record) {
    const unit = stringValue(record.unit).toLowerCase();
    const valueText = stringValue(record.value_text || record.text || record.value).toLowerCase();
    if (unit === "shares" && !/\$|usd|dollar/.test(valueText)) return null;
    return (
      parseMoney(record.numeric_value) ??
      parseMoney(record.value_text) ??
      parseMoney(record.amount) ??
      parseMoney(record.price) ??
      parseMoney(record.value) ??
      parseMoney(record.text)
    );
  }

  const text = stringValue(value).toLowerCase();
  if (!text) return null;
  const match = text.match(/\$?\s*(\d[\d,.]*)\s*(thousand|million|billion|m|bn|k)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const scale = match[2]?.toLowerCase();
  if (scale === "thousand" || scale === "k") return base * 1_000;
  if (scale === "million" || scale === "m") return base * 1_000_000;
  if (scale === "billion" || scale === "bn") return base * 1_000_000_000;
  return base;
}

function percent(numerator: number | null, denominator: number | null) {
  if (!isPositiveNumber(numerator) || !isPositiveNumber(denominator)) return null;
  return roundPercent((numerator / denominator) * 100);
}

function roundPercent(value: number) {
  return Number(value.toFixed(2));
}

function classifyDilutionScale(shareImpactPercent: number | null, amountPercent: number | null): SecOfferingDilutionMetrics["dilution_scale"] {
  const value = Math.max(shareImpactPercent || 0, amountPercent || 0);
  if (!value) return "unknown";
  if (value >= 50) return "severe";
  if (value >= 20) return "high";
  if (value >= 10) return "elevated";
  if (value >= 5) return "moderate";
  return "low";
}

function preliminaryScoreFloor(scale: SecOfferingDilutionMetrics["dilution_scale"]) {
  switch (scale) {
    case "severe":
      return 90;
    case "high":
      return 75;
    case "elevated":
      return 70;
    case "moderate":
      return 55;
    case "low":
      return 35;
    default:
      return null;
  }
}

export function applySecOfferingScorePolicy(
  filingPackage: Record<string, unknown>,
  analysis: Record<string, unknown>,
) {
  const metrics = readRecord(filingPackage.dilution_metrics);
  if (!metrics) return analysis;

  const action = stringValue(analysis.analysis_action);
  if (action === "skip_analysis") {
    return {
      ...analysis,
      score: Math.min(clampScore(finiteNumber(analysis.score) || 0), 15),
      event_type: "other",
      signal: "neutral",
    };
  }

  const currentScore = clampScore(finiteNumber(analysis.score) || 0);
  const floor = finiteNumber(metrics.preliminary_score_floor);
  const cap = finiteNumber(metrics.preliminary_score_cap);
  const deliveryHint = stringValue(metrics.delivery_hint);
  const policyReasons = Array.isArray(metrics.score_policy_reasons)
    ? metrics.score_policy_reasons.map((item) => stringValue(item)).filter(Boolean)
    : [];
  const baseShelfNoSaleTerms = policyReasons.some((reason) =>
    /^(?:base_shelf|automatic_shelf)_goes_to_feed$/.test(reason),
  );
  const fallbackShelfCap =
    policyReasons.includes("small_shelf_capacity_at_least_100pct_market_cap")
      ? 88
      : policyReasons.includes("small_shelf_capacity_at_least_50pct_market_cap") ||
          policyReasons.includes("small_shelf_share_capacity_at_least_20pct")
        ? 84
        : policyReasons.includes("large_shelf_capacity_no_alert_without_sale_terms")
          ? 74
          : 65;
  const feedOnlyCap = deliveryHint === "feed" ? 74 : null;
  const shelfCap =
    baseShelfNoSaleTerms && deliveryHint === "feed"
      ? Math.min(cap || fallbackShelfCap, fallbackShelfCap)
      : null;
  const policyCap = minNullable([cap, feedOnlyCap, shelfCap]);
  const effectiveCap =
    policyCap !== null && deliveryHint !== "feed" && floor !== null && policyCap < floor ? null : policyCap;
  const adjustedScore = clampScore(Math.min(effectiveCap || 100, Math.max(floor || 0, currentScore)));
  const shouldBeFeedOrHigher = deliveryHint === "feed" || deliveryHint === "alert" || deliveryHint === "urgent";
  const adjustedAction = shouldBeFeedOrHigher ? "analyze_offering" : action;
  const adjustedEventType = shouldBeFeedOrHigher || adjustedScore >= 50 ? "dilution_risk" : analysis.event_type;
  const policyAdjusted =
    adjustedScore !== currentScore ||
    adjustedAction !== action ||
    adjustedEventType !== analysis.event_type;

  if (!policyAdjusted) return analysis;

  return {
    ...analysis,
    analysis_action: adjustedAction,
    event_type: adjustedEventType,
    score: adjustedScore,
    score_reason: shortScoreReason(stringValue(analysis.score_reason), metrics),
  };
}

function buildScorePolicy({
  filingPackage,
  s3,
  offeringTerms,
  dilutionScale,
  maxShareImpactPercent,
  offeringAmountPercentOfMarketCap,
}: {
  filingPackage: Record<string, unknown>;
  s3: Record<string, unknown> | null;
  offeringTerms: Record<string, unknown> | null;
  dilutionScale: SecOfferingDilutionMetrics["dilution_scale"];
  maxShareImpactPercent: number | null;
  offeringAmountPercentOfMarketCap: number | null;
}) {
  const formType = stringValue(filingPackage.form_type).toUpperCase();
  const s3Case = classifyS3PolicyCase({ formType, s3, offeringTerms });
  const baseFloor = preliminaryScoreFloor(dilutionScale);
  const reasons: string[] = [];
  let floor = baseFloor;
  let cap: number | null = null;
  let deliveryHint: SecOfferingDilutionMetrics["delivery_hint"] =
    baseFloor !== null && baseFloor >= 50 ? "feed" : null;
  const hasShareSupply = isPositiveNumber(maxShareImpactPercent);
  const hasAmountSupply = isPositiveNumber(offeringAmountPercentOfMarketCap);
  const hasConcreteTerms = hasConcreteOfferingTerms(offeringTerms);

  if (s3Case === "routine_amendment") {
    return {
      floor: null,
      cap: 15,
      deliveryHint: "skip" as const,
      reasons: ["routine_s3_amendment_default_skip"],
    };
  }

  if (s3Case === "base_shelf" || s3Case === "automatic_shelf") {
    const smallIssuerShelf = isSmallIssuerMarketCap(filingPackage);
    floor = smallIssuerShelf ? 55 : 50;
    cap = smallIssuerShelf ? 65 : 59;
    deliveryHint = "feed";
    reasons.push(`${s3Case}_goes_to_feed`);

    if (smallIssuerShelf && isPositiveNumber(maxShareImpactPercent) && maxShareImpactPercent >= 50) {
      floor = Math.max(floor, 88);
      cap = Math.max(cap, 88);
      deliveryHint = "alert";
      reasons.push("small_shelf_share_capacity_at_least_50pct");
    } else if (smallIssuerShelf && isPositiveNumber(maxShareImpactPercent) && maxShareImpactPercent >= 20) {
      floor = Math.max(floor, 75);
      cap = Math.max(cap, 84);
      deliveryHint = "alert";
      reasons.push("small_shelf_share_capacity_at_least_20pct");
    } else if (isPositiveNumber(offeringAmountPercentOfMarketCap) && offeringAmountPercentOfMarketCap >= 25) {
      if (smallIssuerShelf && offeringAmountPercentOfMarketCap >= 100) {
        floor = Math.max(floor, 85);
        cap = Math.max(cap, 88);
        deliveryHint = "alert";
        reasons.push("small_shelf_capacity_at_least_100pct_market_cap");
      } else if (smallIssuerShelf && offeringAmountPercentOfMarketCap >= 50) {
        floor = Math.max(floor, 75);
        cap = Math.max(cap, 84);
        deliveryHint = "alert";
        reasons.push("small_shelf_capacity_at_least_50pct_market_cap");
      } else {
        floor = Math.max(floor, 65);
        cap = Math.max(cap, 74);
        reasons.push("large_shelf_capacity_no_alert_without_sale_terms");
      }
    }
  }

  if (s3Case === "resale_registration") {
    floor = Math.max(floor || 0, 60);
    deliveryHint = "feed";
    reasons.push("resale_registration_feed_floor");
  }

  if (s3Case === "atm_program" || s3Case === "mixed_shelf") {
    floor = Math.max(floor || 0, 65);
    deliveryHint = "feed";
    reasons.push(`${s3Case}_feed_floor`);
  }

  if (s3Case === "other_s3" && (hasConcreteTerms || hasShareSupply || hasAmountSupply)) {
    floor = Math.max(floor || 0, 60);
    deliveryHint = "feed";
    reasons.push("concrete_s3_terms_feed_floor");
  }

  if (
    isPositiveNumber(maxShareImpactPercent) &&
    s3Case !== "base_shelf" &&
    s3Case !== "automatic_shelf"
  ) {
    if (maxShareImpactPercent >= 50) {
      floor = Math.max(floor || 0, 90);
      deliveryHint = "urgent";
      reasons.push("share_or_float_impact_at_least_50pct");
    } else if (maxShareImpactPercent >= 20) {
      floor = Math.max(floor || 0, 75);
      deliveryHint = "alert";
      reasons.push("share_or_float_impact_at_least_20pct");
    }
  }

  if (isPositiveNumber(offeringAmountPercentOfMarketCap)) {
    if (offeringAmountPercentOfMarketCap >= 50 && s3Case !== "base_shelf" && s3Case !== "automatic_shelf") {
      floor = Math.max(floor || 0, 90);
      deliveryHint = "urgent";
      reasons.push("offering_amount_at_least_50pct_market_cap");
    } else if (offeringAmountPercentOfMarketCap >= 25 && s3Case !== "base_shelf" && s3Case !== "automatic_shelf") {
      floor = Math.max(floor || 0, 75);
      deliveryHint = "alert";
      reasons.push("offering_amount_at_least_25pct_market_cap");
    }
  }

  if (!deliveryHint && floor !== null && floor >= 50) {
    deliveryHint = "feed";
    reasons.push("score_floor_feed_hint");
  }

  if (cap !== null && floor !== null && cap < floor) {
    cap = null;
    reasons.push("score_cap_removed_below_policy_floor");
  }

  return {
    floor,
    cap,
    deliveryHint,
    reasons,
  };
}

function classifyS3PolicyCase({
  formType,
  s3,
  offeringTerms,
}: {
  formType: string;
  s3: Record<string, unknown> | null;
  offeringTerms: Record<string, unknown> | null;
}) {
  const amendment = readRecord(s3?.amendment);
  if (formType === "S-3/A" && !hasMaterialS3AmendmentSignal(s3, offeringTerms, amendment)) {
    return "routine_amendment";
  }

  const registrationKind = stringValue(s3?.registration_statement_kind || offeringTerms?.registration_statement_kind);
  const offeringType = stringValue(offeringTerms?.offering_type);
  const primaryOrResale = stringValue(s3?.primary_or_resale || offeringTerms?.primary_or_resale);
  const hasConcreteTerms = hasConcreteOfferingTerms(offeringTerms);
  const isAutomaticShelf =
    formType === "S-3ASR" ||
    registrationKind === "automatic_shelf" ||
    registrationKind === "automatic_shelf_registration" ||
    registrationKind.includes("automatic_shelf");

  if (primaryOrResale === "resale" || offeringType === "resale_registration") return "resale_registration";
  if (offeringType === "atm" || offeringType === "at_the_market") return "atm_program";
  if (isAutomaticShelf && !hasConcreteTerms) return "automatic_shelf";
  if (offeringType === "mixed" && (registrationKind.includes("shelf") || formType === "S-3" || formType === "S-3/A") && !hasConcreteTerms) {
    return "base_shelf";
  }
  if (offeringType === "mixed") return "mixed_shelf";
  if (
    !hasConcreteTerms &&
    (registrationKind.includes("shelf") || offeringType === "shelf_registration" || formType === "S-3")
  ) {
    return "base_shelf";
  }
  return "other_s3";
}

function hasConcreteOfferingTerms(offeringTerms: Record<string, unknown> | null) {
  if (!offeringTerms) return false;
  return Boolean(
    stringValue(offeringTerms.offering_price) ||
      stringValue(offeringTerms.sales_agent) ||
      stringValue(offeringTerms.closing_date) ||
      stringValue(offeringTerms.atm_program_size) ||
      stringValue(offeringTerms.discount_to_market) ||
      stringValue(offeringTerms.conversion_price) ||
      stringValue(offeringTerms.warrant_exercise_price),
  );
}

function hasMaterialS3AmendmentSignal(
  s3: Record<string, unknown> | null,
  offeringTerms: Record<string, unknown> | null,
  amendment: Record<string, unknown> | null,
) {
  if (!s3) return false;
  const feeTable = readRecord(s3.fee_table);
  const sellingStockholders = readRecord(s3.selling_stockholders);
  const changeSignals = Array.isArray(amendment?.change_signal_candidates) ? amendment.change_signal_candidates : [];
  if (changeSignals.length > 0) return true;
  if (feeTable?.present === true || finiteNumber(feeTable?.row_count)) return true;
  if (finiteNumber(sellingStockholders?.count)) return true;

  return Boolean(
    stringValue(s3.resale_share_count) ||
      stringValue(s3.shares_registered) ||
      stringValue(offeringTerms?.offering_amount) ||
      stringValue(offeringTerms?.atm_program_size) ||
      stringValue(offeringTerms?.resale_share_count) ||
      stringValue(offeringTerms?.warrant_coverage) ||
      stringValue(offeringTerms?.conversion_price),
  );
}

function isSmallIssuerMarketCap(filingPackage: Record<string, unknown>) {
  const marketContext = readRecord(filingPackage.market_context);
  const marketCap = finiteNumber(marketContext?.market_cap);
  return Boolean(marketCap && marketCap < 300_000_000);
}

function shortScoreReason(currentReason: string, metrics: Record<string, unknown>) {
  const reasons = Array.isArray(metrics.score_policy_reasons)
    ? metrics.score_policy_reasons.map((item) => stringValue(item)).filter(Boolean)
    : [];
  const policyReason = reasons[0] || "";
  if (!policyReason) return currentReason;
  const readable = policyReason.replace(/_/g, " ");
  return readable.length > 80 ? readable.slice(0, 80) : readable;
}

function buildCalculationNotes({
  sharesOffered,
  currentShares,
  publicFloat,
  marketCap,
}: {
  sharesOffered: number | null;
  currentShares: number | null;
  publicFloat: number | null;
  marketCap: number | null;
}) {
  const notes: string[] = [];
  if (!sharesOffered) notes.push("shares_offered_not_available");
  if (!currentShares) notes.push("shares_outstanding_not_available");
  if (!publicFloat) notes.push("public_float_not_available");
  if (!marketCap) notes.push("market_cap_not_available");
  return notes;
}

function maxNumber(values: Array<number | null>) {
  const finiteValues = values.filter(isPositiveNumber);
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function minNullable(values: Array<number | null>) {
  const finiteValues = values.filter(isPositiveNumber);
  return finiteValues.length ? Math.min(...finiteValues) : null;
}

function firstRecord(value: unknown): PersistedRow | null {
  if (Array.isArray(value)) return readRecord(value[0]);
  return readRecord(value);
}

function readRecord(value: unknown): PersistedRow | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PersistedRow) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeSymbol(value: string) {
  return stringValue(value).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function mostRecent(values: Array<string | null | undefined>) {
  const dates = values
    .map((value) => stringValue(value))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return dates[0] || null;
}
