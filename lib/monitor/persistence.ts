type Row = Record<string, unknown>;
type MutationResult = { ok: boolean; status: number; data: unknown; error?: string };

export type MonitorPersistenceRepository = {
  select(table: string, search: Record<string, string>): Promise<MutationResult>;
  replaceMarketSnapshots(eventId: string, rows: Row[]): Promise<MutationResult>;
  replaceOwnershipFacts(eventId: string, form4Rows: Row[], form144Rows: Row[]): Promise<MutationResult>;
};

export type EventSnapshotSubject = {
  symbol: string;
  exchange?: string | null;
  securityKey?: string | null;
  securityType?: string | null;
};

export type PersistOptionalMonitorFoundationInput = {
  eventId: string;
  eventTime: string;
  primaryTicker?: EventSnapshotSubject | null;
  analysisMarketContext?: unknown;
  ownershipParserOutput?: unknown;
  // "known" means a successful parser result, including a successful empty
  // result that must clear stale rows. Missing/failed/not-applicable input must
  // not be promoted to known-empty because it must preserve prior valid facts.
  ownershipInputState?: "known" | "not_applicable";
};

export type OptionalMonitorPersistenceResult = {
  ok: boolean;
  failures: Array<{ scope: "market_snapshots" | "ownership_facts"; error: string }>;
  marketSnapshotCount: number;
  form4TransactionCount: number;
  form144ProposedSaleCount: number;
};

const marketSnapshotMaxAgeMs = 24 * 60 * 60 * 1000;
const tickerCatalogMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

export async function persistOptionalMonitorFoundation(
  input: PersistOptionalMonitorFoundationInput,
  repository?: MonitorPersistenceRepository,
): Promise<OptionalMonitorPersistenceResult> {
  const resolvedRepository = await resolveRepository(repository);
  const result: OptionalMonitorPersistenceResult = {
    ok: true,
    failures: [],
    marketSnapshotCount: 0,
    form4TransactionCount: 0,
    form144ProposedSaleCount: 0,
  };

  const [marketResult, ownershipResult] = await Promise.allSettled([
    persistEventMarketSnapshots(input, resolvedRepository),
    persistOwnershipParserFacts(input, resolvedRepository),
  ]);

  if (marketResult.status === "fulfilled") {
    result.marketSnapshotCount = marketResult.value;
  } else {
    result.failures.push({ scope: "market_snapshots", error: safeError(marketResult.reason) });
  }

  if (ownershipResult.status === "fulfilled") {
    result.form4TransactionCount = ownershipResult.value.form4TransactionCount;
    result.form144ProposedSaleCount = ownershipResult.value.form144ProposedSaleCount;
  } else {
    result.failures.push({ scope: "ownership_facts", error: safeError(ownershipResult.reason) });
  }

  result.ok = result.failures.length === 0;
  if (!result.ok) {
    console.warn("[monitor-foundation] optional persistence did not complete", {
      eventId: input.eventId,
      failures: result.failures,
    });
  }
  return result;
}

export async function persistEventMarketSnapshots(
  input: PersistOptionalMonitorFoundationInput,
  repository?: MonitorPersistenceRepository,
) {
  const resolvedRepository = await resolveRepository(repository);
  const eventId = requiredUuidLike(input.eventId, "eventId");
  const eventTime = requiredTimestamp(input.eventTime, "eventTime");
  const analysisContexts = extractAnalysisMarketContexts(input.analysisMarketContext, input.primaryTicker?.symbol);
  const subjects = await collectSnapshotSubjects(eventId, input.primaryTicker, analysisContexts, resolvedRepository);

  const rows = await Promise.all(
    subjects.map((subject) => resolveEventMarketSnapshotRow({ eventId, eventTime, subject, analysisContexts }, resolvedRepository)),
  );
  const persisted = await resolvedRepository.replaceMarketSnapshots(eventId, rows);
  assertMonitorMutation(persisted, "event market snapshots");
  return rows.length;
}

export async function persistOwnershipParserFacts(
  input: PersistOptionalMonitorFoundationInput,
  repository?: MonitorPersistenceRepository,
) {
  const resolvedRepository = await resolveRepository(repository);
  const eventId = requiredUuidLike(input.eventId, "eventId");
  if (input.ownershipInputState !== "known") {
    return { form4TransactionCount: 0, form144ProposedSaleCount: 0 };
  }
  const rows = buildOwnershipFactRows({
    eventId,
    symbol: input.primaryTicker?.symbol || null,
    parserOutput: input.ownershipParserOutput,
  });

  const persisted = await resolvedRepository.replaceOwnershipFacts(
    eventId,
    rows.form4Transactions,
    rows.form144ProposedSales,
  );
  assertMonitorMutation(persisted, "ownership facts");

  return {
    form4TransactionCount: rows.form4Transactions.length,
    form144ProposedSaleCount: rows.form144ProposedSales.length,
  };
}

export function buildOwnershipFactRows({
  eventId,
  symbol,
  parserOutput,
}: {
  eventId: string;
  symbol?: string | null;
  parserOutput: unknown;
}) {
  requiredUuidLike(eventId, "eventId");
  const output = record(parserOutput);
  const facts = record(output?.facts);
  if (!output || !facts) throw new Error("Ownership parser output is not a successful typed result");
  const filing = record(facts?.filing);
  const form4 = record(facts?.form4);
  const form144 = record(facts?.form144);
  const confidence = sourceConfidence(filing?.source_confidence);
  const normalizedSymbol = normalizeSymbol(symbol || record(facts?.issuer)?.ticker);
  const provenance = {
    source: "sec_ownership_parser",
    parser_version: string(output?.parserVersion) || null,
    source_format: string(filing?.source_format) || null,
    source_confidence: string(filing?.source_confidence) || null,
    accession_number: string(output?.accessionNumber) || null,
  };
  const reportingOwners = records(facts?.reporting_owners);
  const reportingOwnerNames = reportingOwners
    .map((owner) => nullableString(owner.name))
    .filter((name): name is string => Boolean(name));
  const reportingOwnerRoles = uniqueStrings(reportingOwners.flatMap((owner) => stringArray(owner.roles)));
  const officerTitles = uniqueStrings(reportingOwners.map((owner) => nullableString(owner.title)));
  const isOfficer = anySuppliedBoolean(reportingOwners, "is_officer");
  const isDirector = anySuppliedBoolean(reportingOwners, "is_director");
  const is10PercentOwner = anySuppliedBoolean(reportingOwners, "is_ten_percent_owner");
  const is10b51 = nullableBoolean(filing?.aff_10b5_1);

  const form4Transactions = records(form4?.transactions).map((transaction, transactionIndex) => {
    const shares = nonnegativeNumber(transaction.shares);
    const price = nonnegativeNumber(transaction.price_per_share);
    const postTransactionShares = nonnegativeNumber(transaction.shares_owned_following);
    const transactionValue = shares !== null && price !== null ? round(shares * price, 4) : null;
    return compact({
      event_id: eventId,
      transaction_index: transactionIndex,
      symbol: normalizedSymbol,
      reporting_owner_names: reportingOwnerNames,
      reporting_owner_roles: reportingOwnerRoles,
      officer_titles: officerTitles,
      is_officer: isOfficer,
      is_director: isDirector,
      is_10_percent_owner: is10PercentOwner,
      officer_title: officerTitles.length === 1 ? officerTitles[0] : null,
      is_10b5_1: is10b51,
      transaction_kind: oneOf(transaction.transaction_kind, ["non_derivative", "derivative"]) || "non_derivative",
      security_title: nullableString(transaction.security_title),
      transaction_date: date(transaction.transaction_date),
      deemed_execution_date: date(transaction.deemed_execution_date),
      transaction_code: uppercaseCode(transaction.transaction_code),
      acquired_disposed_code: oneOf(transaction.acquired_disposed_code, ["A", "D"]),
      shares,
      shares_quality: shares === null ? null : "exact",
      shares_value_quality: valueQuality(shares, "exact"),
      shares_availability: availability(shares),
      price_per_share: price,
      price_per_share_quality: price === null ? null : "exact",
      price_per_share_value_quality: valueQuality(price, "exact"),
      price_per_share_availability: availability(price),
      transaction_value: transactionValue,
      transaction_value_quality: transactionValue === null ? null : "derived",
      transaction_value_value_quality: valueQuality(transactionValue, "derived"),
      transaction_value_availability: availability(transactionValue),
      post_transaction_shares: postTransactionShares,
      post_transaction_shares_value_quality: valueQuality(postTransactionShares, "exact"),
      post_transaction_shares_availability: availability(postTransactionShares),
      direct_or_indirect_ownership: oneOf(transaction.direct_or_indirect_ownership, ["D", "I"]),
      nature_of_ownership: nullableString(transaction.nature_of_ownership),
      fact_as_of: date(transaction.transaction_date),
      confidence,
      provenance,
      evidence: stringArray(transaction.evidence),
      calculation_basis: transactionValue === null
        ? {}
        : {
            formula: "shares * price_per_share",
            numerator_field: "shares",
            multiplier_field: "price_per_share",
          },
      updated_at: new Date().toISOString(),
    });
  });

  const proposedSaleRows = records(form144?.proposed_sale_rows);
  const sourceRows = proposedSaleRows.length
    ? proposedSaleRows
    : form144 && hasForm144UsableFact(form144)
      ? [form144]
      : [];
  const form144ProposedSales = sourceRows.map((sale, proposedSaleIndex) => {
    const securitiesToBeSold = nonnegativeNumber(sale.securities_to_be_sold);
    const aggregateMarketValue = nonnegativeNumber(sale.aggregate_market_value);
    const sharesOutstanding = nonnegativeNumber(sale.shares_outstanding);
    const proposedSalePercent = securitiesToBeSold !== null && sharesOutstanding !== null && sharesOutstanding > 0
      ? round((securitiesToBeSold / sharesOutstanding) * 100, 8)
      : null;
    return compact({
      event_id: eventId,
      proposed_sale_index: proposedSaleIndex,
      symbol: normalizedSymbol,
      seller_name: nullableString(form144?.seller_name) || nullableString(form144?.account_person_name),
      security_title: nullableString(sale.securities_class_title) || nullableString(form144?.securities_class_title),
      exchange: nullableString(sale.securities_exchange_name) || nullableString(form144?.securities_exchange_name),
      securities_to_be_sold: securitiesToBeSold,
      securities_to_be_sold_quality: securitiesToBeSold === null ? null : "exact",
      securities_to_be_sold_value_quality: valueQuality(securitiesToBeSold, "exact"),
      securities_to_be_sold_availability: availability(securitiesToBeSold),
      aggregate_market_value: aggregateMarketValue,
      aggregate_market_value_quality: aggregateMarketValue === null ? null : "exact",
      aggregate_market_value_value_quality: valueQuality(aggregateMarketValue, "exact"),
      aggregate_market_value_availability: availability(aggregateMarketValue),
      approximate_sale_date: date(sale.approximate_sale_date) || date(form144?.approximate_sale_date),
      shares_outstanding: sharesOutstanding,
      shares_outstanding_quality: sharesOutstanding === null ? null : "exact",
      shares_outstanding_value_quality: valueQuality(sharesOutstanding, "exact"),
      shares_outstanding_availability: availability(sharesOutstanding),
      proposed_sale_percent: proposedSalePercent,
      proposed_sale_percent_quality: proposedSalePercent === null ? null : "derived",
      proposed_sale_percent_value_quality: valueQuality(proposedSalePercent, "derived"),
      proposed_sale_percent_availability: availability(proposedSalePercent),
      fact_as_of: date(sale.approximate_sale_date) || date(form144?.approximate_sale_date),
      confidence,
      provenance,
      evidence: uniqueStrings([
        ...stringArray(sale.evidence),
        nullableString(sale.securities_to_be_sold_text),
        nullableString(sale.aggregate_market_value_text),
        nullableString(sale.shares_outstanding_text),
        nullableString(sale.approximate_sale_date_text),
      ]),
      calculation_basis: proposedSalePercent === null
        ? {}
        : {
            formula: "securities_to_be_sold / shares_outstanding * 100",
            numerator_field: "securities_to_be_sold",
            denominator_field: "shares_outstanding",
            unit: "percent",
          },
      updated_at: new Date().toISOString(),
    });
  });

  return { form4Transactions, form144ProposedSales };
}

async function collectSnapshotSubjects(
  eventId: string,
  primaryTicker: EventSnapshotSubject | null | undefined,
  analysisContexts: AnalysisMarketContext[],
  repository: MonitorPersistenceRepository,
) {
  const subjects = new Map<string, EventSnapshotSubject>();
  const add = (subject: EventSnapshotSubject) => {
    const symbol = normalizeSymbol(subject.symbol);
    if (!symbol) return;
    const securityKey = normalizeSecurityKey(subject.securityKey || subject.securityType || "primary");
    subjects.set(`${symbol}:${securityKey}`, { ...subject, symbol, securityKey });
  };
  if (primaryTicker) add(primaryTicker);

  const linked = await repository.select("event_tickers", {
    select: "symbol,exchange,metadata",
    event_id: `eq.${eventId}`,
    order: "sort_order.asc",
    limit: "50",
  });
  assertMonitorRead(linked, "event ticker subjects");
  for (const row of records(linked.data)) {
    const metadata = record(row.metadata);
    add({
      symbol: string(row.symbol),
      exchange: nullableString(row.exchange),
      securityKey: nullableString(metadata?.security_key) || nullableString(metadata?.cusip) || "primary",
      securityType: nullableString(metadata?.security_type) || nullableString(metadata?.asset_type),
    });
  }

  for (const context of analysisContexts) {
    if (!context.symbol) continue;
    add({
      symbol: context.symbol,
      exchange: context.exchange,
      securityKey: context.securityKey,
      securityType: context.securityType,
    });
  }
  return [...subjects.values()];
}

type AnalysisMarketContext = {
  value: Row;
  symbol: string | null;
  exchange: string | null;
  securityKey: string;
  securityType: string | null;
};

export function extractAnalysisMarketContexts(value: unknown, primarySymbol?: string | null): AnalysisMarketContext[] {
  const root = record(value);
  if (!root) return [];
  const candidates = [
    root,
    ...records(root.snapshots),
    ...records(root.securities),
    ...records(root.tickers),
    ...records(root.quotes),
  ];
  const normalizedPrimary = normalizeSymbol(primarySymbol);
  return candidates
    .map((candidate, index) => {
      const explicitSymbol = normalizeSymbol(candidate.symbol || candidate.ticker);
      const securityType = nullableString(candidate.security_type) || nullableString(candidate.asset_type);
      const rawSecurityKey =
        nullableString(candidate.security_key) ||
        nullableString(candidate.security_id) ||
        nullableString(candidate.cusip) ||
        securityType ||
        (index === 0 ? "primary" : `security-${index}`);
      return {
        value: candidate,
        symbol: explicitSymbol || normalizedPrimary,
        exchange: nullableString(candidate.exchange) || nullableString(candidate.market),
        securityKey: normalizeSecurityKey(rawSecurityKey),
        securityType,
      };
    })
    .filter((context) => context.symbol && hasMarketValue(context.value));
}

async function resolveEventMarketSnapshotRow(
  input: {
    eventId: string;
    eventTime: string;
    subject: EventSnapshotSubject;
    analysisContexts: AnalysisMarketContext[];
  },
  repository: MonitorPersistenceRepository,
) {
  const symbol = normalizeSymbol(input.subject.symbol) as string;
  const securityKey = normalizeSecurityKey(input.subject.securityKey || input.subject.securityType || "primary");
  const matchingContext =
    input.analysisContexts.find((context) => context.symbol === symbol && context.securityKey === securityKey) ||
    input.analysisContexts.find((context) => context.symbol === symbol && context.securityKey === "primary") ||
    input.analysisContexts.find((context) => context.symbol === symbol) ||
    null;
  const eventMs = Date.parse(input.eventTime);
  const fieldSources: Record<string, unknown> = {};
  const sourceNames = new Set<string>();
  const sourceKinds = new Set<string>();
  const contextValue = matchingContext?.value;
  let price = analysisMarketValue(contextValue, ["price", "latest_price", "previous_close"], "price");
  let marketCap = analysisMarketValue(contextValue, ["market_cap"], "market_cap");
  let sharesOutstanding = analysisMarketValue(contextValue, ["shares_outstanding"], "shares_outstanding");
  let floatShares = analysisMarketValue(contextValue, ["public_float", "float_shares", "float"], "public_float");
  let sourceAsOf = timestamp(
    contextValue?.as_of || contextValue?.fetched_at || contextValue?.retrieved_at,
  );
  for (const [key, fact] of Object.entries({ price, market_cap: marketCap, shares_outstanding: sharesOutstanding, float_shares: floatShares })) {
    if (fact.value !== null) {
      const sourceKey = key === "float_shares" && nonnegativeNumber(contextValue?.public_float) !== null ? "public_float" : key;
      const source = marketFieldSource(contextValue, sourceKey) || "analysis_market_context";
      fieldSources[key] = { kind: "analysis_context", source, as_of: sourceAsOf, value_quality: fact.quality };
      sourceKinds.add("analysis_context");
      sourceNames.add(source);
    }
  }

  if ([price, marketCap, sharesOutstanding, floatShares].some((fact) => fact.value === null)) {
    const [snapshotsResult, quotesResult, tickerResult] = await Promise.all([
      repository.select("market_snapshots", {
        select: "ticker,price,market_cap,shares_outstanding,float_shares,source,fetched_at",
        ticker: `eq.${symbol}`,
        order: "fetched_at.desc",
        limit: "1",
      }),
      repository.select("market_quotes", {
        select: "symbol,provider,price,previous_close,fetched_at,expires_at",
        symbol: `eq.${symbol}`,
        limit: "1",
      }),
      repository.select("tickers", {
        select: "symbol,market_cap,last_profiled_at,updated_at,metadata",
        symbol: `eq.${symbol}`,
        limit: "1",
      }),
    ]);
    assertMonitorRead(snapshotsResult, `${symbol} market snapshots`);
    assertMonitorRead(quotesResult, `${symbol} market quote cache`);
    assertMonitorRead(tickerResult, `${symbol} ticker market-cap cache`);
    const localSnapshot = freshRow(first(snapshotsResult.data), eventMs, marketSnapshotMaxAgeMs, "fetched_at");
    const quote = validQuote(first(quotesResult.data), eventMs);
    const ticker = freshRow(first(tickerResult.data), eventMs, tickerCatalogMaxAgeMs, "last_profiled_at", "updated_at");

    if (price.value === null) {
      const localValue = nonnegativeNumber(localSnapshot?.price);
      const quoteValue = nonnegativeNumber(quote?.price) ?? nonnegativeNumber(quote?.previous_close);
      const sourceRow = localValue !== null ? localSnapshot : quoteValue !== null ? quote : null;
      const value = localValue ?? quoteValue;
      if (value !== null && sourceRow) {
        price = { value, quality: "exact" };
        const isSnapshot = sourceRow === localSnapshot;
        const source = nullableString(sourceRow.source) || nullableString(sourceRow.provider) || (isSnapshot ? "market_snapshots" : "market_quotes");
        const asOf = timestamp(sourceRow.fetched_at);
        fieldSources.price = { kind: isSnapshot ? "local_market_snapshot" : "local_cache", source, as_of: asOf, value_quality: "exact" };
        sourceKinds.add(isSnapshot ? "local_market_snapshot" : "local_cache");
        sourceNames.add(source);
        sourceAsOf = latestTimestamp(sourceAsOf, asOf);
      }
    }
    if (marketCap.value === null) {
      const snapshotValue = nonnegativeNumber(localSnapshot?.market_cap);
      const tickerValue = nonnegativeNumber(ticker?.market_cap);
      const sourceRow = snapshotValue !== null ? localSnapshot : tickerValue !== null ? ticker : null;
      const value = snapshotValue ?? tickerValue;
      if (value !== null && sourceRow) {
        marketCap = { value, quality: "exact" };
        const isSnapshot = sourceRow === localSnapshot;
        const source = nullableString(sourceRow.source) || (isSnapshot ? "market_snapshots" : "tickers");
        const asOf = timestamp(sourceRow.fetched_at || sourceRow.last_profiled_at || sourceRow.updated_at);
        fieldSources.market_cap = { kind: isSnapshot ? "local_market_snapshot" : "local_cache", source, as_of: asOf, value_quality: "exact" };
        sourceKinds.add(isSnapshot ? "local_market_snapshot" : "local_cache");
        sourceNames.add(source);
        sourceAsOf = latestTimestamp(sourceAsOf, asOf);
      }
    }
    if (sharesOutstanding.value === null) {
      const value = nonnegativeNumber(localSnapshot?.shares_outstanding);
      if (value !== null && localSnapshot) {
        sharesOutstanding = { value, quality: "exact" };
        const source = nullableString(localSnapshot.source) || "market_snapshots";
        const asOf = timestamp(localSnapshot.fetched_at);
        fieldSources.shares_outstanding = { kind: "local_market_snapshot", source, as_of: asOf, value_quality: "exact" };
        sourceKinds.add("local_market_snapshot");
        sourceNames.add(source);
        sourceAsOf = latestTimestamp(sourceAsOf, asOf);
      }
    }
    if (floatShares.value === null) {
      const value = nonnegativeNumber(localSnapshot?.float_shares);
      if (value !== null && localSnapshot) {
        floatShares = { value, quality: "exact" };
        const source = nullableString(localSnapshot.source) || "market_snapshots";
        const asOf = timestamp(localSnapshot.fetched_at);
        fieldSources.float_shares = { kind: "local_market_snapshot", source, as_of: asOf, value_quality: "exact" };
        sourceKinds.add("local_market_snapshot");
        sourceNames.add(source);
        sourceAsOf = latestTimestamp(sourceAsOf, asOf);
      }
    }
  }

  const snapshotStatus = price.value !== null && marketCap.value !== null
    ? "available"
    : price.value !== null || marketCap.value !== null
      ? "partial"
      : "unavailable";
  const sourceKind = sourceKinds.size > 1
      ? "mixed"
      : [...sourceKinds][0] || "unavailable";
  return compact({
    event_id: input.eventId,
    symbol,
    security_key: securityKey,
    exchange: nullableString(input.subject.exchange) || matchingContext?.exchange || null,
    security_type: nullableString(input.subject.securityType) || matchingContext?.securityType || null,
    snapshot_status: snapshotStatus,
    event_time: input.eventTime,
    source_as_of: sourceAsOf,
    price: price.value,
    price_value_quality: price.quality,
    price_availability: availability(price.value),
    market_cap: marketCap.value,
    market_cap_value_quality: marketCap.quality,
    market_cap_availability: availability(marketCap.value),
    shares_outstanding: sharesOutstanding.value,
    shares_outstanding_value_quality: sharesOutstanding.quality,
    shares_outstanding_availability: availability(sharesOutstanding.value),
    float_shares: floatShares.value,
    float_shares_value_quality: floatShares.quality,
    float_shares_availability: availability(floatShares.value),
    source_kind: sourceKind,
    source_name: [...sourceNames].join("+") || null,
    unavailable_reason: snapshotStatus === "unavailable" ? "analysis_context_and_valid_local_market_data_unavailable" : null,
    provenance: {
      resolution_order: ["analysis_context", "market_snapshots", "market_quotes", "tickers"],
      no_external_fetch: true,
    },
    field_sources: fieldSources,
    updated_at: new Date().toISOString(),
  });
}

function freshRow(value: unknown, eventMs: number, maxAgeMs: number, ...timestampKeys: string[]) {
  const row = record(value);
  if (!row) return null;
  const observedAt = timestampKeys.map((key) => timestamp(row[key])).find(Boolean);
  if (!observedAt) return null;
  const observedMs = Date.parse(observedAt);
  if (observedMs > eventMs + 5 * 60 * 1000 || eventMs - observedMs > maxAgeMs) return null;
  return row;
}

function validQuote(value: unknown, eventMs: number) {
  const row = freshRow(value, eventMs, marketSnapshotMaxAgeMs, "fetched_at");
  if (!row) return null;
  const expiresAt = timestamp(row.expires_at);
  return expiresAt && Date.parse(expiresAt) >= eventMs ? row : null;
}

function hasMarketValue(value: Row) {
  return [
    marketPrice(value),
    nonnegativeNumber(value.market_cap),
    nonnegativeNumber(value.shares_outstanding),
    nonnegativeNumber(value.public_float),
    nonnegativeNumber(value.float_shares),
    nonnegativeNumber(value.float),
  ].some((item) => item !== null);
}

function marketPrice(value: Row | null | undefined) {
  if (!value) return null;
  return nonnegativeNumber(value.price) ?? nonnegativeNumber(value.latest_price) ?? nonnegativeNumber(value.previous_close);
}

type ValueQuality = "exact" | "derived" | "estimated" | "unknown";

function analysisMarketValue(value: Row | null | undefined, keys: string[], qualityKey: string) {
  const numeric = keys.map((key) => nonnegativeNumber(value?.[key])).find((item) => item !== null) ?? null;
  const quality = marketFieldQuality(value, qualityKey);
  if (numeric === null) return { value: null, quality: "unknown" as const };
  return { value: numeric, quality };
}

function marketFieldQuality(value: Row | null | undefined, key: string): ValueQuality {
  const candidate =
    record(value?.field_quality)?.[key] ??
    record(value?.value_quality)?.[key] ??
    value?.[`${key}_value_quality`] ??
    value?.[`${key}_quality`];
  return oneOf(candidate, ["exact", "derived", "estimated", "unknown"] as const) || "exact";
}

function marketFieldSource(value: Row | null | undefined, key: string) {
  return nullableString(record(value?.field_sources)?.[key]) || nullableString(value?.source) || nullableString(value?.provider);
}

function latestTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function hasForm144UsableFact(value: Row) {
  return [
    value.securities_to_be_sold,
    value.aggregate_market_value,
    value.shares_outstanding,
    value.approximate_sale_date,
  ].some((item) => item !== null && item !== undefined && item !== "");
}

function sourceConfidence(value: unknown) {
  const normalized = string(value).toLowerCase();
  return normalized === "high" ? 0.95 : normalized === "medium" ? 0.75 : normalized === "low" ? 0.5 : 0.5;
}

function normalizeSecurityKey(value: unknown) {
  const normalized = string(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "primary";
}

function normalizeSymbol(value: unknown) {
  const normalized = string(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(normalized) ? normalized : null;
}

function uppercaseCode(value: unknown) {
  const normalized = string(value).toUpperCase();
  return /^[A-Z]$/.test(normalized) ? normalized : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]) {
  const normalized = string(value) as T;
  return allowed.includes(normalized) ? normalized : null;
}

function nonnegativeNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function valueQuality(value: number | null, availableQuality: Exclude<ValueQuality, "unknown">): ValueQuality {
  return value === null ? "unknown" : availableQuality;
}

function availability(value: number | null) {
  return value === null ? "unavailable" : "available";
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function anySuppliedBoolean(rows: Row[], key: string) {
  const values = rows.map((row) => nullableBoolean(row[key])).filter((value): value is boolean => value !== null);
  return values.length ? values.some(Boolean) : null;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function date(value: unknown) {
  const normalized = string(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) && Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))
    ? normalized
    : null;
}

function timestamp(value: unknown) {
  const normalized = string(value);
  if (!normalized || !Number.isFinite(Date.parse(normalized))) return null;
  return new Date(normalized).toISOString();
}

function requiredTimestamp(value: unknown, field: string) {
  const normalized = timestamp(value);
  if (!normalized) throw new Error(`Invalid ${field}`);
  return normalized;
}

function requiredUuidLike(value: unknown, field: string) {
  const normalized = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized)) throw new Error(`Invalid ${field}`);
  return normalized;
}

function compact<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

function records(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(record(item))) : [];
}

function first(value: unknown) {
  return Array.isArray(value) ? value[0] || null : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function nullableString(value: unknown) {
  return string(value) || null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(string).filter(Boolean).slice(0, 20) : [];
}

function uniqueStrings(value: Array<string | null>) {
  return [...new Set(value.filter((item): item is string => Boolean(item)))].slice(0, 20);
}

function assertMonitorMutation(result: MutationResult, label: string) {
  if (!result.ok) throw new Error(`Could not persist ${label}: ${result.error || `HTTP ${result.status}`}`);
}

function assertMonitorRead(result: MutationResult, label: string) {
  if (!result.ok) throw new Error(`Could not read ${label}: ${result.error || `HTTP ${result.status}`}`);
}

async function resolveRepository(repository?: MonitorPersistenceRepository): Promise<MonitorPersistenceRepository> {
  if (repository) return repository;
  const supabase = await import("../supabase.ts");
  return {
    select: supabase.supabaseSelect,
    replaceMarketSnapshots: (eventId, rows) =>
      supabase.supabaseRpc("replace_event_market_snapshots", { p_event_id: eventId, p_rows: rows }),
    replaceOwnershipFacts: (eventId, form4Rows, form144Rows) =>
      supabase.supabaseRpc("replace_event_ownership_facts", {
        p_event_id: eventId,
        p_form4_rows: form4Rows,
        p_form144_rows: form144Rows,
      }),
  };
}

function safeError(value: unknown) {
  return value instanceof Error ? value.message.slice(0, 500) : "Optional monitor persistence failed";
}
