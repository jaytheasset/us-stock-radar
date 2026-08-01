import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import {
  calculateMargin,
  calculatePercentChange,
  calculateTrailingEquityCashFlow,
  findPriorYearQuarter,
  sumAvailable,
  type StockBeneficialOwnershipFiling,
  type StockFinancialQuarter,
  type StockFundamentalsSnapshot,
  type StockFundamentalsSourceKey,
  type StockInsiderTrade,
} from "@/lib/watchlist/stockFundamentals";
import type { StockOverviewEvent } from "@/lib/watchlist/stockOverview";
import watchlistStyles from "./StockRadarWatchlistV2.module.css";
import styles from "./StockFundamentalsSections.module.css";

type FundamentalsLoadState = "idle" | "loading" | "ready" | "unavailable";

type StockFundamentalsSectionsProps = {
  dilutionEvents: StockOverviewEvent[];
  financialEvents: StockOverviewEvent[];
  loadState: FundamentalsLoadState;
  ownershipEvents: StockOverviewEvent[];
  snapshot: StockFundamentalsSnapshot | null;
};

export function StockFundamentalsSections({
  dilutionEvents,
  financialEvents,
  loadState,
  ownershipEvents,
  snapshot,
}: StockFundamentalsSectionsProps) {
  return (
    <>
      <FinancialsSection
        events={financialEvents}
        loadState={loadState}
        snapshot={snapshot}
      />
      <OwnershipSection
        events={ownershipEvents}
        loadState={loadState}
        snapshot={snapshot}
      />
      <DilutionSection
        events={dilutionEvents}
        loadState={loadState}
        snapshot={snapshot}
      />
    </>
  );
}

function FinancialsSection({
  events,
  loadState,
  snapshot,
}: SectionProps) {
  const quarters = snapshot?.financials.quarters ?? [];
  const annuals = snapshot?.financials.annuals ?? [];
  const latest = quarters[0] ?? null;
  const previous = quarters[1] ?? null;
  const priorYear = findPriorYearQuarter(quarters, latest);
  const unavailableSources = getUnavailableSources(snapshot, [
    "incomeStatement",
    "balanceSheet",
    "cashFlow",
  ]);

  if (!latest) {
    return (
      <SectionState
        id="watchlist-financials"
        loadState={loadState}
        number="02"
        title="Financials"
      />
    );
  }

  const grossMargin = calculateMargin(latest.grossProfit, latest.revenue);
  const previousGrossMargin = calculateMargin(
    previous?.grossProfit,
    previous?.revenue,
  );
  const operatingMargin = calculateMargin(
    latest.operatingIncome,
    latest.revenue,
  );
  const quarterLabels = quarters.map(formatQuarterLabel);
  const annualLabels = annuals.map(formatQuarterLabel);
  const rows = [
    {
      label: "Revenue",
      values: quarters.map((quarter) => formatUsd(quarter.revenue)),
    },
    {
      label: "Gross margin",
      values: quarters.map((quarter) =>
        formatPercent(calculateMargin(quarter.grossProfit, quarter.revenue)),
      ),
    },
    {
      label: "Operating income",
      values: quarters.map((quarter) => formatUsd(quarter.operatingIncome)),
    },
    {
      label: "Net income",
      values: quarters.map((quarter) => formatUsd(quarter.netIncome)),
    },
    {
      label: "Diluted EPS",
      values: quarters.map((quarter) => formatEps(quarter.epsDiluted)),
    },
    {
      label: "Free cash flow",
      values: quarters.map((quarter) => formatUsd(quarter.freeCashFlow)),
    },
  ];
  const annualRows = [
    {
      label: "Revenue",
      values: annuals.map((period) => formatUsd(period.revenue)),
    },
    {
      label: "Operating income",
      values: annuals.map((period) => formatUsd(period.operatingIncome)),
    },
    {
      label: "Net income",
      values: annuals.map((period) => formatUsd(period.netIncome)),
    },
    {
      label: "Diluted EPS",
      values: annuals.map((period) => formatEps(period.epsDiluted)),
    },
    {
      label: "Operating cash flow",
      values: annuals.map((period) => formatUsd(period.operatingCashFlow)),
    },
    {
      label: "Free cash flow",
      values: annuals.map((period) => formatUsd(period.freeCashFlow)),
    },
  ];

  return (
    <section
      aria-labelledby="watchlist-financials-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-financials"
    >
      <DataSectionHeader
        asOf={`${latest.reportedCurrency || "Currency unavailable"} · ${formatQuarterLabel(latest)} actual · filed ${formatDate(latest.filingDate)} · refreshed ${formatDate(snapshot?.fetchedAt)}`}
        id="watchlist-financials-title"
        number="02"
        title="Financials"
      />
      {unavailableSources.length ? (
        <SourceNotice sources={unavailableSources} />
      ) : null}

      <div className={styles.financialOverviewGrid}>
        <article className={styles.latestEarnings}>
          <div className={styles.financialCardHeading}>
            <div>
              <span>LATEST REPORTED QUARTER</span>
              <h3>{formatQuarterLabel(latest)}</h3>
            </div>
            <time dateTime={latest.filingDate}>
              Filed {formatDate(latest.filingDate)}
            </time>
          </div>
          <div
            aria-label="Latest reported quarter comparison"
            className={styles.earningsComparison}
            role="table"
          >
            <div className={styles.earningsComparisonHeader} role="row">
              <span role="columnheader">Metric</span>
              <span role="columnheader">Actual</span>
              <span role="columnheader">QoQ</span>
              <span role="columnheader">YoY</span>
            </div>
            <EarningsRow
              actual={formatUsd(latest.revenue)}
              metric="Revenue"
              qoq={formatSignedPercent(
                calculatePercentChange(latest.revenue, previous?.revenue),
              )}
              yoy={formatSignedPercent(
                calculatePercentChange(latest.revenue, priorYear?.revenue),
              )}
            />
            <EarningsRow
              actual={formatEps(latest.epsDiluted)}
              metric="Diluted EPS"
              qoq={formatSignedPercent(
                calculatePercentChange(latest.epsDiluted, previous?.epsDiluted),
              )}
              yoy={formatSignedPercent(
                calculatePercentChange(latest.epsDiluted, priorYear?.epsDiluted),
              )}
            />
          </div>
          <div className={styles.earningsFooter}>
            <Metric
              label="GROSS MARGIN"
              note="Reported"
              value={formatPercent(grossMargin)}
            />
            <Metric
              label="OPERATING MARGIN"
              note="Reported"
              value={formatPercent(operatingMargin)}
            />
            <Metric
              label="FREE CASH FLOW"
              note="Reported"
              value={formatUsd(latest.freeCashFlow)}
            />
          </div>
        </article>

        <article className={styles.financialChanges}>
          <div className={styles.financialCardHeading}>
            <div>
              <span>REPORTED MOVEMENT</span>
              <h3>What Changed</h3>
            </div>
          </div>
          <ul>
            <FinancialChange
              detail={`${formatQuarterLabel(latest)} vs. ${formatQuarterLabel(previous)}`}
              label="Revenue"
              value={formatSignedPercent(
                calculatePercentChange(latest.revenue, previous?.revenue),
              )}
            />
            <FinancialChange
              detail={`${formatQuarterLabel(latest)} vs. prior-year quarter`}
              label="Revenue"
              value={formatSignedPercent(
                calculatePercentChange(latest.revenue, priorYear?.revenue),
              )}
            />
            <FinancialChange
              detail="Quarter-over-quarter"
              label="Gross margin"
              value={formatBasisPointChange(grossMargin, previousGrossMargin)}
            />
          </ul>
        </article>
      </div>

      <div className={styles.keyFundamentals}>
        <div className={styles.keyFundamentalsHeading}>
          <strong>Key Fundamentals</strong>
          <span>Reported values only · no consensus data</span>
        </div>
        <dl>
          <Metric
            label="Revenue"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.revenue)}
          />
          <Metric
            label="Net income"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.netIncome)}
          />
          <Metric
            label="Cash"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.cashAndShortTermInvestments)}
          />
          <Metric
            label="Total debt"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.totalDebt)}
          />
          <Metric
            label="Total equity"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.totalStockholdersEquity)}
          />
          <Metric
            label="Operating cash flow"
            note={formatQuarterLabel(latest)}
            value={formatUsd(latest.operatingCashFlow)}
          />
        </dl>
      </div>

      <details className={styles.detailDisclosure}>
        <DisclosureSummary
          detail={`${quarters.length} reported quarters`}
          title="Quarterly trends"
        />
        <div className={styles.disclosureBody}>
          <div
            aria-label="Reported quarterly financial trends"
            className={styles.financialTable}
            role="table"
          >
            <div className={styles.financialHeader} role="row">
              <span role="columnheader">Metric</span>
              {quarterLabels.map((quarter) => (
                <span key={quarter} role="columnheader">
                  {quarter}
                  <small>Actual</small>
                </span>
              ))}
            </div>
            {rows.map((row) => (
              <div className={styles.financialRow} key={row.label} role="row">
                <strong role="rowheader">{row.label}</strong>
                {row.values.map((value, index) => (
                  <span
                    data-label={quarterLabels[index]}
                    key={`${row.label}-${quarterLabels[index]}`}
                    role="cell"
                  >
                    {value}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className={styles.methodNote}>
            YoY and QoQ are calculated from like-for-like reported fields only.
            Baselines that are missing, zero, or negative are shown as unavailable.
            {events.length
              ? ` ${events.length} financial filing or event records are available in News & Events.`
              : ""}
          </p>
        </div>
      </details>

      <details className={styles.detailDisclosure}>
        <DisclosureSummary
          detail={`${annuals.length} reported fiscal years`}
          title="Annual trends"
        />
        <div className={styles.disclosureBody}>
          {annuals.length ? (
            <div
              aria-label="Reported annual financial trends"
              className={styles.financialTable}
              role="table"
            >
              <div className={styles.financialHeader} role="row">
                <span role="columnheader">Metric</span>
                {annualLabels.map((period) => (
                  <span key={period} role="columnheader">
                    {period}
                    <small>Actual</small>
                  </span>
                ))}
              </div>
              {annualRows.map((row) => (
                <div className={styles.financialRow} key={row.label} role="row">
                  <strong role="rowheader">{row.label}</strong>
                  {row.values.map((value, index) => (
                    <span
                      data-label={annualLabels[index]}
                      key={`${row.label}-${annualLabels[index]}`}
                      role="cell"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.methodNote}>
              Annual statements are unavailable while quarterly actuals remain visible.
            </p>
          )}
          <p className={styles.methodNote}>
            Monetary values use the filing&apos;s reported currency and compact display units.
            Annual and quarterly periods are kept separate.
          </p>
        </div>
      </details>
    </section>
  );
}

function OwnershipSection({
  events,
  loadState,
  snapshot,
}: SectionProps) {
  const statistic = snapshot?.ownership.statistics[0] ?? null;
  const trades = snapshot?.ownership.trades ?? [];
  const beneficialOwners =
    snapshot?.ownership.reportedBeneficialOwners ?? [];
  const beneficialFilings = snapshot?.ownership.beneficialFilings ?? [];
  const institutionalSummary = snapshot?.ownership.institutionalSummary ?? null;
  const institutionalHolders = snapshot?.ownership.institutionalHolders ?? [];
  const hasOwnershipData =
    Boolean(statistic) ||
    Boolean(institutionalSummary) ||
    trades.length > 0 ||
    beneficialFilings.length > 0 ||
    institutionalHolders.length > 0 ||
    events.length > 0;

  if (!snapshot || (!hasOwnershipData && loadState !== "ready")) {
    return (
      <SectionState
        id="watchlist-ownership"
        loadState={loadState}
        number="03"
        title="Ownership"
      />
    );
  }

  const totalAcquired = statistic?.totalAcquired ?? null;
  const totalDisposed = statistic?.totalDisposed ?? null;
  const netInsiderShares =
    totalAcquired === null || totalDisposed === null
      ? null
      : totalAcquired - totalDisposed;
  const ownershipUnavailable = getUnavailableSources(snapshot, [
    "insiderStatistics",
    "insiderTrades",
    "beneficialOwnership",
    "institutionalOwnership",
  ]);

  return (
    <section
      aria-labelledby="watchlist-ownership-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-ownership"
    >
      <DataSectionHeader
        asOf={
          statistic
            ? `Insider statistics · Q${statistic.quarter} ${statistic.year}`
            : `Ownership filings · ${formatDate(beneficialFilings[0]?.filingDate)}`
        }
        id="watchlist-ownership-title"
        number="03"
        title="Ownership"
      />
      {ownershipUnavailable.length ? (
        <SourceNotice sources={ownershipUnavailable} />
      ) : null}
      <dl className={styles.ownershipSummaryStrip}>
        <Metric
          label="Insider acquired"
          value={formatShares(totalAcquired)}
        />
        <Metric
          label="Insider disposed"
          value={formatShares(totalDisposed)}
        />
        <Metric
          label="Insider net"
          value={formatSignedShares(netInsiderShares)}
        />
        <Metric
          label="Purchase transactions"
          value={formatInteger(statistic?.totalPurchases)}
        />
        <Metric
          label="Sale transactions"
          value={formatInteger(statistic?.totalSales)}
        />
      </dl>

      <div className={styles.ownershipOverview}>
        <section
          aria-labelledby="watchlist-ownership-changes"
          className={styles.ownershipChanges}
        >
          <div className={styles.ownershipSubheader}>
            <h3 id="watchlist-ownership-changes">
              Recent insider activity
            </h3>
            <p>Reported transactions, not an estimate of total ownership</p>
          </div>
          <div className={styles.ownershipChangeList}>
            {trades.slice(0, 3).map((trade, index) => (
              <InsiderActivity
                key={`${insiderTradeKey(trade)}-${index}`}
                trade={trade}
              />
            ))}
            {!trades.length ? (
              <p className={styles.methodNote}>
                No insider transaction rows were returned.
              </p>
            ) : null}
          </div>
        </section>
        {institutionalSummary || institutionalHolders.length ? (
          <div className={styles.planCard}>
            <strong>Institutional ownership</strong>
            <span>{formatPercent(institutionalSummary?.ownershipPercent)} reported</span>
            <span>
              13F period {formatInstitutionalPeriod(institutionalSummary)} ·{" "}
              {formatInteger(institutionalSummary?.investorsHolding)} reporting holders
            </span>
          </div>
        ) : (
          <div className={styles.planCard}>
            <strong>Institutional ownership</strong>
            <span>Unavailable on the current FMP plan.</span>
            <span>
              No institutional percentage or Top 13F holder ranking is inferred.
              Local SEC ownership filings remain available below.
            </span>
          </div>
        )}
      </div>

      <details className={styles.ownershipDisclosure}>
        <DisclosureSummary
          detail={`${trades.length} recent reported transactions`}
          title="Insider transaction history"
        />
        <div className={styles.ownershipDisclosureBody}>
          <div
            aria-label="Recent reported insider transactions"
            className={styles.dilutionEventTable}
            role="table"
          >
            <div className={styles.dilutionEventHeader} role="row">
              <span role="columnheader">Filed</span>
              <span role="columnheader">Form</span>
              <span role="columnheader">Insider / transaction</span>
              <span role="columnheader">Shares</span>
              <span role="columnheader">Price</span>
            </div>
            {trades.map((trade, index) => (
              <div
                className={styles.dilutionEventRow}
                key={`${insiderTradeKey(trade)}-${index}`}
                role="row"
              >
                <time data-label="Filed" dateTime={trade.filingDate} role="cell">
                  {formatDateShort(trade.filingDate)}
                </time>
                <span
                  className={styles.dilutionForm}
                  data-label="Form"
                  role="cell"
                >
                  {trade.formType || "—"}
                </span>
                <div className={styles.dilutionEventDetail} role="cell">
                  <strong>{trade.reportingName}</strong>
                  <small>{formatTransactionType(trade.transactionType)}</small>
                </div>
                <span
                  className={styles.dilutionEffect}
                  data-label="Shares"
                  role="cell"
                >
                  {formatShares(trade.securitiesTransacted)}
                </span>
                <span
                  className={styles.dilutionEventStatus}
                  data-label="Price"
                  role="cell"
                >
                  {formatPrice(trade.price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </details>

      {institutionalHolders.length ? (
        <details className={styles.ownershipDisclosure}>
          <DisclosureSummary
            detail={`${institutionalHolders.length} holders · ${formatInstitutionalPeriod(institutionalSummary)}`}
            title="Institutional holders"
          />
          <div className={styles.ownershipDisclosureBody}>
            <div
              aria-label="Reported institutional holders"
              className={styles.ownershipTable}
              role="table"
            >
              <div className={styles.ownershipTableHeader} role="row">
                <span role="columnheader">Holder</span>
                <span role="columnheader">Shares</span>
                <span role="columnheader">Change</span>
                <span role="columnheader">As of</span>
              </div>
              {institutionalHolders.map((holder) => (
                <div className={styles.ownershipTableRow} key={`${holder.holder}-${holder.asOf}`} role="row">
                  <strong role="cell">{holder.holder}</strong>
                  <span data-label="Shares" role="cell">{formatShares(holder.shares)}</span>
                  <span data-label="Change" role="cell">{formatSignedShares(holder.changeInShares)}</span>
                  <span data-label="As of" role="cell">{formatDateShort(holder.asOf)}</span>
                </div>
              ))}
            </div>
            <p className={styles.methodNote}>
              13F values use their reported quarter and are not aligned to insider or beneficial-owner filing dates.
            </p>
          </div>
        </details>
      ) : null}

      <details className={styles.ownershipDisclosure} open>
        <DisclosureSummary
          detail={`${beneficialOwners.length} latest non-zero owner reports · ${beneficialFilings.length} filing rows`}
          title="5%+ beneficial ownership filings"
        />
        <div className={styles.ownershipDisclosureBody}>
          {beneficialOwners.length ? (
            <div
              aria-label="Reported beneficial owners"
              className={styles.ownershipTable}
              role="table"
            >
              <div className={styles.ownershipTableHeader} role="row">
                <span role="columnheader">Reporting person</span>
                <span role="columnheader">Shares</span>
                <span role="columnheader">Class</span>
                <span role="columnheader">Filed</span>
              </div>
              {beneficialOwners.slice(0, 6).map((filing) => (
                <BeneficialOwnerRow
                  filing={filing}
                  key={`${filing.nameOfReportingPerson}-${filing.filingDate}`}
                />
              ))}
            </div>
          ) : (
            <p className={styles.methodNote}>
              No non-zero beneficial-owner report was returned.
            </p>
          )}
          <p className={styles.methodNote}>
            This is a filing-based list, not aggregate institutional ownership
            or a Top 13F ranking. A reporting person&apos;s latest zero-share or
            zero-percent row is retained in filing history but excluded from
            the reported-owner list. Older non-zero filings are historical
            reports and are not presented as proof of current ownership. The
            table shows the six most recent latest reports by reporting name.
          </p>
        </div>
      </details>

      <RelatedFilings
        events={events}
        title="Related ownership filings"
        type="ownership"
      />
    </section>
  );
}

function DilutionSection({
  events,
  loadState,
  snapshot,
}: SectionProps) {
  const quarters = snapshot?.financials.quarters ?? [];
  const latest = quarters[0] ?? null;
  const priorYear = findPriorYearQuarter(quarters, latest);
  const float = snapshot?.sharesFloat ?? null;
  const shareHistory = snapshot?.shareHistory ?? [];
  const splits = snapshot?.splits ?? [];
  const latestSharePoint = shareHistory[0] ?? null;
  const oldestSharePoint = shareHistory.at(-1) ?? null;
  const hasDilutionData = Boolean(
    latest || float || shareHistory.length || splits.length || events.length,
  );

  if (!snapshot || (!hasDilutionData && loadState !== "ready")) {
    return (
      <SectionState
        id="watchlist-dilution"
        loadState={loadState}
        number="04"
        title="Dilution"
      />
    );
  }

  const trailing = calculateTrailingEquityCashFlow(quarters);
  const trailingSbc = sumAvailable(
    quarters.slice(0, 4).map((quarter) => quarter.stockBasedCompensation),
  );
  const dilutionUnavailable = getUnavailableSources(snapshot, [
    "sharesFloat",
    "sharesHistory",
    "splits",
    "incomeStatement",
    "cashFlow",
  ]);
  const latestNetEquityCashFlow = calculateQuarterEquityCashFlow(latest);

  return (
    <section
      aria-labelledby="watchlist-dilution-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-dilution"
    >
      <DataSectionHeader
        asOf={`Share snapshot ${formatDate(float?.asOf)} · financials ${formatQuarterLabel(latest)} · refreshed ${formatDate(snapshot?.fetchedAt)}`}
        id="watchlist-dilution-title"
        number="04"
        title="Dilution"
      />
      {dilutionUnavailable.length ? (
        <SourceNotice sources={dilutionUnavailable} />
      ) : null}
      <dl className={styles.dilutionSummary}>
        <Metric
          label="Shares outstanding"
          note="Latest float snapshot"
          value={formatShares(float?.outstandingShares)}
        />
        <Metric
          label="Float shares"
          note="Latest float snapshot"
          value={formatShares(float?.floatShares)}
        />
        <Metric
          label="Free float"
          note="Latest float snapshot"
          value={formatPercent(float?.freeFloat)}
        />
        <Metric
          label="Diluted avg shares"
          note={`${formatSignedPercent(
            calculatePercentChange(
              latest?.weightedAverageShsOutDil,
              priorYear?.weightedAverageShsOutDil,
            ),
          )} YoY`}
          value={formatShares(latest?.weightedAverageShsOutDil)}
        />
        <Metric
          label="Reported shares trend"
          note={`${formatSignedPercent(
            calculatePercentChange(
              latestSharePoint?.shares,
              oldestSharePoint?.shares,
            ),
          )} since ${formatDateShort(oldestSharePoint?.date)}`}
          value={formatShares(latestSharePoint?.shares)}
        />
        <Metric
          label="SBC · trailing 4Q"
          note="Non-cash expense"
          value={formatUsd(trailingSbc)}
        />
        <Metric
          label="Net equity cash flow · 4Q"
          note="Issuance less repurchases"
          value={formatUsd(trailing.net)}
        />
      </dl>
      <div className={styles.dilutionStatus}>
        <div>
          <strong>Measured share-supply indicators</strong>
          <p>
            Latest-quarter net equity cash flow is{" "}
            {formatUsd(latestNetEquityCashFlow)}. Filing coverage is shown
            separately and is not a risk rating.
          </p>
        </div>
        <span>{events.length} RELATED FILINGS</span>
      </div>

      <details className={styles.dilutionDisclosure} open>
        <DisclosureSummary
          detail={`${quarters.length} reported quarters · issuance and repurchases normalized`}
          title="Recent share supply activity"
        />
        <div className={styles.disclosureBody}>
          <div
            aria-label="Recent reported share supply activity"
            className={styles.dilutionEventTable}
            role="table"
          >
            <div className={styles.dilutionEventHeader} role="row">
              <span role="columnheader">Filed</span>
              <span role="columnheader">Quarter</span>
              <span role="columnheader">Diluted average shares</span>
              <span role="columnheader">QoQ / YoY</span>
              <span role="columnheader">Equity cash flow</span>
            </div>
            {quarters.map((quarter, index) => {
              const priorQuarter = quarters[index + 1];
              const yearQuarter = findPriorYearQuarter(quarters, quarter);
              return (
                <div
                  className={styles.dilutionEventRow}
                  key={`${quarter.fiscalYear}-${quarter.period}`}
                  role="row"
                >
                  <time
                    data-label="Filed"
                    dateTime={quarter.filingDate}
                    role="cell"
                  >
                    {formatDateShort(quarter.filingDate)}
                  </time>
                  <span
                    className={styles.dilutionForm}
                    data-label="Quarter"
                    role="cell"
                  >
                    {formatQuarterLabel(quarter)}
                  </span>
                  <div className={styles.dilutionEventDetail} role="cell">
                    <strong>
                      {formatShares(quarter.weightedAverageShsOutDil)}
                    </strong>
                    <small>Weighted-average diluted basis</small>
                  </div>
                  <span
                    className={styles.dilutionEffect}
                    data-label="QoQ / YoY"
                    role="cell"
                  >
                    {formatSignedPercent(
                      calculatePercentChange(
                        quarter.weightedAverageShsOutDil,
                        priorQuarter?.weightedAverageShsOutDil,
                      ),
                    )}{" "}
                    /{" "}
                    {formatSignedPercent(
                      calculatePercentChange(
                        quarter.weightedAverageShsOutDil,
                        yearQuarter?.weightedAverageShsOutDil,
                      ),
                    )}
                  </span>
                  <span
                    className={styles.dilutionEventStatus}
                    data-label="Equity cash flow"
                    role="cell"
                  >
                    {formatUsd(calculateQuarterEquityCashFlow(quarter))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className={styles.methodNote}>
            Common stock issuance and repurchase cash-flow fields are normalized
            to positive magnitudes before netting. A negative net value means
            repurchase cash outflow exceeded issuance proceeds; it is not a
            direct count of shares retired.
          </p>
        </div>
      </details>

      <details className={styles.dilutionDisclosure} open>
        <DisclosureSummary
          detail={`${shareHistory.length} reported share-count periods · ${splits.length} split records`}
          title="Shares outstanding and split history"
        />
        <div className={styles.disclosureBody}>
          {shareHistory.length ? (
            <div
              aria-label="Reported shares outstanding history"
              className={styles.ownershipTable}
              role="table"
            >
              <div className={styles.ownershipTableHeader} role="row">
                <span role="columnheader">Period</span>
                <span role="columnheader">Reported shares</span>
                <span role="columnheader">Change</span>
                <span role="columnheader">Basis</span>
              </div>
              {shareHistory.map((point, index) => (
                <div className={styles.ownershipTableRow} key={point.date} role="row">
                  <strong role="cell">{formatDateShort(point.date)}</strong>
                  <span data-label="Reported shares" role="cell">{formatShares(point.shares)}</span>
                  <span data-label="Change" role="cell">
                    {formatSignedPercent(
                      calculatePercentChange(point.shares, shareHistory[index + 1]?.shares),
                    )}
                  </span>
                  <span data-label="Basis" role="cell">FMP enterprise value period</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.methodNote}>
              Historical shares outstanding are unavailable. This does not mean share count was unchanged.
            </p>
          )}
          {splits.length ? (
            <div
              aria-label="Reported stock split history"
              className={styles.ownershipTable}
              role="table"
            >
              <div className={styles.ownershipTableHeader} role="row">
                <span role="columnheader">Effective</span>
                <span role="columnheader">Ratio</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Source</span>
              </div>
              {splits.map((split) => (
                <div className={styles.ownershipTableRow} key={`${split.date}-${split.numerator}-${split.denominator}`} role="row">
                  <strong role="cell">{formatDateShort(split.date)}</strong>
                  <span data-label="Ratio" role="cell">{formatSplitRatio(split.numerator, split.denominator)}</span>
                  <span data-label="Type" role="cell">
                    {split.numerator < split.denominator ? "Reverse split" : "Forward split"}
                  </span>
                  <span data-label="Source" role="cell">FMP split record</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.methodNote}>
              No split row was returned. This is a provider coverage state, not proof that no split occurred.
            </p>
          )}
          <p className={styles.methodNote}>
            Share-count changes are calculated only between reported positive values. They are not presented as an offering-specific dilution estimate.
          </p>
        </div>
      </details>

      <RelatedFilings
        events={events}
        title="Related dilution filings"
        type="dilution"
      />
    </section>
  );
}

type SectionProps = {
  events: StockOverviewEvent[];
  loadState: FundamentalsLoadState;
  snapshot: StockFundamentalsSnapshot | null;
};

function SectionState({
  id,
  loadState,
  number,
  title,
}: {
  id: string;
  loadState: FundamentalsLoadState;
  number: string;
  title: string;
}) {
  const loading = loadState === "loading" || loadState === "idle";
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id={id}
    >
      <DataSectionHeader
        asOf={loading ? "Loading reported data" : "Source unavailable"}
        id={`${id}-title`}
        number={number}
        title={title}
      />
      <div className={styles.dataState}>
        <strong>{loading ? "Loading reported data…" : "Data unavailable"}</strong>
        <span>
          {loading
            ? "This section updates independently from the rest of the page."
            : "The available upstream sources did not return usable rows."}
        </span>
      </div>
    </section>
  );
}

function DataSectionHeader({
  asOf,
  id,
  number,
  title,
}: {
  asOf: string;
  id: string;
  number: string;
  title: string;
}) {
  return (
    <div className={styles.dataSectionHeader}>
      <div className={watchlistStyles.sectionHeading}>
        <span>{number}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <span>{asOf}</span>
    </div>
  );
}

function EarningsRow({
  actual,
  metric,
  qoq,
  yoy,
}: {
  actual: string;
  metric: string;
  qoq: string;
  yoy: string;
}) {
  return (
    <div className={styles.earningsComparisonRow} role="row">
      <strong role="rowheader">{metric}</strong>
      <span data-label="Actual" role="cell">
        {actual}
      </span>
      <span className={changeToneClass(qoq)} data-label="QoQ" role="cell">
        {qoq}
      </span>
      <span className={changeToneClass(yoy)} data-label="YoY" role="cell">
        {yoy}
      </span>
    </div>
  );
}

function FinancialChange({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <li>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <b className={changeToneClass(value)}>{value}</b>
    </li>
  );
}

function Metric({
  label,
  note,
  value,
}: {
  label: string;
  note?: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function InsiderActivity({ trade }: { trade: StockInsiderTrade }) {
  return (
    <article>
      <time className={styles.ownershipFilingDate} dateTime={trade.filingDate}>
        <span>{formatDateShort(trade.filingDate)}</span>
        <small>{trade.formType || "Filing"}</small>
      </time>
      <span className={styles.ownershipFilingBadge}>
        {trade.transactionType || "TRADE"}
      </span>
      <div>
        <strong>{trade.reportingName}</strong>
        <p>
          {formatShares(trade.securitiesTransacted)} ·{" "}
          {formatTransactionType(trade.transactionType)} ·{" "}
          {formatPrice(trade.price)}
        </p>
      </div>
    </article>
  );
}

function BeneficialOwnerRow({
  filing,
}: {
  filing: StockBeneficialOwnershipFiling;
}) {
  return (
    <div className={styles.ownershipTableRow} role="row">
      <strong role="cell">
        {filing.url ? (
          <a
            className={styles.externalLink}
            href={filing.url}
            rel="noreferrer"
            target="_blank"
          >
            {filing.nameOfReportingPerson}
            <ExternalLink aria-hidden="true" size={12} />
          </a>
        ) : (
          filing.nameOfReportingPerson
        )}
      </strong>
      <span data-label="Shares" role="cell">
        {formatShares(filing.amountBeneficiallyOwned)}
      </span>
      <span data-label="Class" role="cell">
        {formatPercent(filing.percentOfClass)}
      </span>
      <span data-label="Filed" role="cell">
        {formatDateShort(filing.filingDate)}
      </span>
    </div>
  );
}

function RelatedFilings({
  events,
  title,
  type,
}: {
  events: StockOverviewEvent[];
  title: string;
  type: "ownership" | "dilution";
}) {
  return (
    <details className={styles.dilutionDisclosure}>
      <DisclosureSummary
        detail={`${events.length} classified local filing${events.length === 1 ? "" : "s"}`}
        title={title}
      />
      <div className={styles.disclosureBody}>
        {events.length ? (
          <div className={styles.ownershipChangeList}>
            {events.map((event) => (
              <article key={event.id}>
                <time
                  className={styles.ownershipFilingDate}
                  dateTime={event.detectedAt}
                >
                  <span>{formatDateShort(event.detectedAt)}</span>
                  <small>{event.source}</small>
                </time>
                <span className={styles.ownershipFilingBadge}>
                  {event.formType || event.category || "FILING"}
                </span>
                <div>
                  <strong>
                    {event.detailHref ? (
                      <Link
                        className={styles.filingLink}
                        href={event.detailHref}
                      >
                        {event.title}
                      </Link>
                    ) : (
                      event.title
                    )}
                  </strong>
                  <p>{event.summary || event.eventType}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.methodNote}>
            No {type} filing was classified in the current local event
            coverage. This is a coverage statement, not evidence that no such
            filing exists.
          </p>
        )}
        {type === "dilution" ? (
          <p className={styles.methodNote}>
            Shelf, ATM, warrant, convertible, and S-8 registrations can
            represent potential capacity. They are not treated as completed
            issuance without a corresponding reported transaction.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function DisclosureSummary({ detail, title }: { detail: string; title: string }) {
  return (
    <summary>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <ChevronRight aria-hidden="true" size={16} />
    </summary>
  );
}

function SourceNotice({
  sources,
}: {
  sources: StockFundamentalsSourceKey[];
}) {
  return (
    <p className={styles.sourceNotice}>
      Partial data: {sources.map(formatSourceName).join(", ")}{" "}
      {sources.length === 1 ? "is" : "are"} partial, plan-limited, or unavailable.
      Available reported fields remain visible.
    </p>
  );
}

function getUnavailableSources(
  snapshot: StockFundamentalsSnapshot | null,
  sources: StockFundamentalsSourceKey[],
) {
  if (!snapshot) return sources;
  return sources.filter((source) => {
    const state = snapshot.sources[source].state;
    return (
      state === "partial" ||
      state === "unavailable" ||
      state === "plan_unavailable"
    );
  });
}

function formatSourceName(source: StockFundamentalsSourceKey) {
  const names: Record<StockFundamentalsSourceKey, string> = {
    balanceSheet: "balance sheet",
    beneficialOwnership: "beneficial ownership",
    cashFlow: "cash flow",
    incomeStatement: "income statement",
    insiderStatistics: "insider statistics",
    insiderTrades: "insider trades",
    institutionalOwnership: "institutional ownership",
    sharesFloat: "share float",
    sharesHistory: "shares outstanding history",
    splits: "stock splits",
  };
  return names[source];
}

function calculateQuarterEquityCashFlow(
  quarter: StockFinancialQuarter | null | undefined,
) {
  if (!quarter) return null;
  const issued = quarter.commonStockIssued;
  const repurchased = quarter.commonStockRepurchased;
  return issued === null || repurchased === null
    ? null
    : issued - repurchased;
}

function formatInstitutionalPeriod(
  summary: StockFundamentalsSnapshot["ownership"]["institutionalSummary"],
) {
  if (!summary) return "period unavailable";
  if (summary.year && summary.quarter) return `Q${summary.quarter} ${summary.year}`;
  return formatDate(summary.asOf);
}

function formatSplitRatio(numerator: number, denominator: number) {
  return `${formatRatioNumber(numerator)}:${formatRatioNumber(denominator)}`;
}

function formatRatioNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatQuarterLabel(
  quarter: StockFinancialQuarter | null | undefined,
) {
  return quarter?.period && quarter.fiscalYear
    ? `${quarter.period} ${quarter.fiscalYear}`
    : "—";
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatShares(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function formatSignedShares(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const formatted = formatShares(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function formatInteger(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEps(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBasisPointChange(
  current: number | null,
  baseline: number | null,
) {
  if (current === null || baseline === null) return "—";
  const basisPoints = Math.round((current - baseline) * 100);
  return `${basisPoints > 0 ? "+" : ""}${basisPoints} bps`;
}

function formatDate(value: string | null | undefined) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : "—";
}

function formatDateShort(value: string | null | undefined) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(date)
    : "—";
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatPrice(value: number | null | undefined) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatTransactionType(value: string) {
  return value ? value.replace(/[-_]+/g, " ") : "Transaction type unavailable";
}

function changeToneClass(value: string) {
  if (value.startsWith("+")) return styles.positive;
  if (value.startsWith("-") || value.startsWith("−")) return styles.negative;
  return undefined;
}

function insiderTradeKey(trade: StockInsiderTrade) {
  return [
    trade.filingDate,
    trade.reportingName,
    trade.transactionType,
    trade.securitiesTransacted,
  ].join("-");
}
