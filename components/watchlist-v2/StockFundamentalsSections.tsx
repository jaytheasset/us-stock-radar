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

  return (
    <section
      aria-labelledby="watchlist-financials-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-financials"
    >
      <DataSectionHeader
        asOf={`${formatQuarterLabel(latest)} actual · filed ${formatDate(latest.filingDate)}`}
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
  const hasOwnershipData =
    Boolean(statistic) ||
    trades.length > 0 ||
    beneficialFilings.length > 0 ||
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
    totalAcquired === null && totalDisposed === null
      ? null
      : (totalAcquired ?? 0) - (totalDisposed ?? 0);
  const ownershipUnavailable = getUnavailableSources(snapshot, [
    "insiderStatistics",
    "insiderTrades",
    "beneficialOwnership",
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
            {trades.slice(0, 3).map((trade) => (
              <InsiderActivity key={insiderTradeKey(trade)} trade={trade} />
            ))}
            {!trades.length ? (
              <p className={styles.methodNote}>
                No insider transaction rows were returned.
              </p>
            ) : null}
          </div>
        </section>
        <div className={styles.planCard}>
          <strong>Institutional ownership</strong>
          <span>Not included in current data plan.</span>
          <span>
            No institutional ownership percentage or Top 13F holders are
            inferred from other sources.
          </span>
        </div>
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
            {trades.map((trade) => (
              <div
                className={styles.dilutionEventRow}
                key={insiderTradeKey(trade)}
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
  const previous = quarters[1] ?? null;
  const priorYear = findPriorYearQuarter(quarters, latest);
  const float = snapshot?.sharesFloat ?? null;
  const hasDilutionData = Boolean(latest || float || events.length);

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
        asOf={`Share snapshot ${formatDate(float?.asOf)} · financials ${formatQuarterLabel(latest)}`}
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
      {sources.length === 1 ? "is" : "are"} unavailable. Available fields remain
      visible.
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
    return state === "unavailable" || state === "plan_unavailable";
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
  };
  return names[source];
}

function calculateQuarterEquityCashFlow(
  quarter: StockFinancialQuarter | null | undefined,
) {
  if (!quarter) return null;
  const issued = quarter.commonStockIssued;
  const repurchased = quarter.commonStockRepurchased;
  return issued === null && repurchased === null
    ? null
    : (issued ?? 0) - (repurchased ?? 0);
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
