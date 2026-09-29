import Link from "next/link";
import { ChevronRight, ExternalLink, LockKeyhole } from "lucide-react";
import {
  type StockFundamentalsSnapshot,
  type StockFundamentalsSourceKey,
} from "@/lib/watchlist/stockFundamentals";
import type {
  StockSc13FilingEvidence,
  StockSc13OwnershipSnapshot,
  StockSc13Position,
  StockSc13ReportedField,
} from "@/lib/watchlist/stockSc13Ownership";
import type {
  StockFinancialBasis,
  StockFinancialCategorySnapshot,
  StockFinancialDisplayRow,
  StockFinancialMetricRow,
  StockFinancialValue,
  StockFinancialsSnapshot,
} from "@/lib/watchlist/stockFinancials";
import type {
  StockDilutionActivity,
  StockDilutionInstrument,
} from "@/lib/dilution-registry/stockDilution";
import type {
  StockDilutionCurrentPreview,
  StockDilutionMembershipResponse,
} from "@/lib/dilution-registry/stockDilutionMembership";
import type { StockOverviewEvent } from "@/lib/watchlist/stockOverview";
import type { StockForm4Transaction } from "@/lib/watchlist/stockForm4Transactions";
import watchlistStyles from "./StockRadarWatchlistV2.module.css";
import styles from "./StockFundamentalsSections.module.css";

type FundamentalsLoadState = "idle" | "loading" | "ready" | "unavailable";

const DILUTION_WIDE_CONVERSION_MIN_CHARACTERS = 32;

type StockFundamentalsSectionsProps = {
  dilutionEvents: StockOverviewEvent[];
  dilutionGuestMode: boolean;
  dilutionLoadState: FundamentalsLoadState;
  dilutionSnapshot: StockDilutionMembershipResponse | null;
  financialEvents: StockOverviewEvent[];
  financialLoadState: FundamentalsLoadState;
  financialSnapshot: StockFinancialsSnapshot | null;
  loadState: FundamentalsLoadState;
  ownershipEvents: StockOverviewEvent[];
  sc13LoadState: FundamentalsLoadState;
  sc13Snapshot: StockSc13OwnershipSnapshot | null;
  secForm4LoadState: FundamentalsLoadState;
  secForm4Transactions: StockForm4Transaction[];
  snapshot: StockFundamentalsSnapshot | null;
};

export function StockFundamentalsSections({
  dilutionEvents,
  dilutionGuestMode,
  dilutionLoadState,
  dilutionSnapshot,
  financialEvents,
  financialLoadState,
  financialSnapshot,
  loadState,
  ownershipEvents,
  sc13LoadState,
  sc13Snapshot,
  secForm4LoadState,
  secForm4Transactions,
  snapshot,
}: StockFundamentalsSectionsProps) {
  return (
    <>
      <FinancialsSection
        events={financialEvents}
        loadState={financialLoadState}
        snapshot={financialSnapshot}
      />
      <OwnershipSection
        events={ownershipEvents}
        loadState={loadState}
        sc13LoadState={sc13LoadState}
        sc13Snapshot={sc13Snapshot}
        secForm4LoadState={secForm4LoadState}
        secForm4Transactions={secForm4Transactions}
        snapshot={snapshot}
      />
      <DilutionSection
        data={dilutionSnapshot}
        events={dilutionEvents}
        isGuest={dilutionGuestMode}
        loadState={dilutionLoadState}
      />
    </>
  );
}

function FinancialsSection({
  events,
  loadState,
  snapshot,
}: {
  events: StockOverviewEvent[];
  loadState: FundamentalsLoadState;
  snapshot: StockFinancialsSnapshot | null;
}) {
  if (!snapshot) {
    return (
      <SectionState
        id="watchlist-financials"
        loadState={loadState}
        number="02"
        title="Financials"
      />
    );
  }

  const availableCount = [
    ...snapshot.quarterly.rows,
    ...snapshot.quarterly.ytdRows,
    ...snapshot.annual.rows,
  ].filter((row) => row.status === "AVAILABLE").length;

  return (
    <section
      aria-labelledby="watchlist-financials-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-financials"
    >
      <DataSectionHeader
        asOf={`SEC XBRL · ${availableCount} resolved observations · refreshed ${formatDate(snapshot.fetchedAt)}`}
        id="watchlist-financials-title"
        number="02"
        title="Financials"
      />
      <div className={styles.secBasisLegend} aria-label="Financial period basis guide">
        <span><strong>Quarter</strong> exact three-month duration</span>
        <span><strong>YTD</strong> cumulative duration; never converted into a quarter</span>
        <span><strong>Annual</strong> fiscal-year duration</span>
        <span><strong>Instant</strong> balance on one date</span>
      </div>

      <FinancialCategory category={snapshot.quarterly} title="Quarterly" />
      <FinancialCategory category={snapshot.annual} title="Annual" />

      <p className={styles.methodNote}>
        Canonical source: stored SEC filing XBRL matched to SEC CompanyFacts by the
        Financial Resolver, then admitted through exact Financial History series.
        No FMP fallback, GPT numeric value, QoQ calculation, currency conversion,
        or YTD-to-quarter conversion is used.
        {events.length
          ? ` ${events.length} related filing or financial event records are available in News & Events.`
          : ""}
      </p>
    </section>
  );
}

function FinancialCategory({
  category,
  title,
}: {
  category: StockFinancialCategorySnapshot;
  title: "Quarterly" | "Annual";
}) {
  return (
    <section className={styles.secFinancialCategory} aria-label={`${title} SEC financials`}>
      <header>
        <div>
          <span>{title.toUpperCase()}</span>
          <h3>{title} reported values</h3>
        </div>
        <small>{formatFinancialFilingSummary(category.latestFiling)}</small>
      </header>
      <FinancialMetricTable rows={category.rows} title={title} />
      {category.ytdRows.length ? (
        <div className={styles.secYtdBlock}>
          <h4>Exact YTD observations</h4>
          <p>Cumulative values are shown separately and are not treated as quarterly values.</p>
          <FinancialMetricTable rows={category.ytdRows} title="YTD" />
        </div>
      ) : null}
    </section>
  );
}

function FinancialMetricTable({
  rows,
  title,
}: {
  rows: StockFinancialDisplayRow[];
  title: string;
}) {
  return (
    <div className={styles.secFinancialTable} role="table" aria-label={`${title} SEC financial metrics`}>
      <div className={styles.secFinancialHeader} role="row">
        <span role="columnheader">Metric</span>
        <span role="columnheader">Basis</span>
        <span role="columnheader">Current</span>
        <span role="columnheader">Prior year</span>
        <span role="columnheader">Change</span>
      </div>
      {rows.map((row) => (
        <FinancialMetricRow key={`${row.metric}-${row.basis ?? "unknown"}`} row={row} />
      ))}
    </div>
  );
}

function FinancialMetricRow({ row }: { row: StockFinancialDisplayRow }) {
  if (row.status === "UNAVAILABLE") {
    return (
      <div className={styles.secFinancialRowGroup} role="rowgroup">
        <div className={styles.secFinancialRow} role="row">
          <strong role="rowheader">{row.label}</strong>
          <span data-label="Basis" role="cell">{basisLabel(row.basis)}</span>
          <span className={styles.secUnavailableCell} data-label="Current" role="cell">
            <b>Unavailable</b>
            <small>{formatUnavailableReason(row.reason)}</small>
          </span>
          <span data-label="Prior year" role="cell">—</span>
          <span data-label="Change" role="cell">—</span>
        </div>
        <p className={styles.secUnavailableDetail}>{row.detail}</p>
      </div>
    );
  }

  return (
    <div className={styles.secFinancialRowGroup} role="rowgroup">
      <div className={styles.secFinancialRow} role="row">
        <strong role="rowheader">{row.label}</strong>
        <span data-label="Basis" role="cell">{basisLabel(row.basis)}</span>
        <FinancialValueCell dataLabel="Current" value={row.value} />
        <FinancialValueCell dataLabel="Prior year" value={row.priorYear} />
        <span
          className={changeToneClass(row.delta ?? "")}
          data-label="Change"
          role="cell"
        >
          {formatFinancialDelta(row)}
        </span>
      </div>
      <FinancialProvenance row={row} />
    </div>
  );
}

function FinancialValueCell({
  dataLabel,
  value,
}: {
  dataLabel: string;
  value: StockFinancialValue | null;
}) {
  return (
    <span data-label={dataLabel} role="cell">
      <b>{value ? formatFinancialMoney(value.value, value.currency) : "—"}</b>
      <small>{value ? formatSecPeriod(value.period) : "No like-for-like comparison"}</small>
    </span>
  );
}

function FinancialProvenance({ row }: { row: StockFinancialMetricRow }) {
  return (
    <details className={styles.secProvenance}>
      <summary>SEC filing provenance</summary>
      <dl>
        <div><dt>Form</dt><dd>{row.provenance.form}</dd></div>
        <div><dt>Report period</dt><dd>{row.provenance.reportDate}</dd></div>
        <div><dt>Filed</dt><dd>{row.provenance.filedDate}</dd></div>
        <div><dt>Currency</dt><dd>{row.value.currency}</dd></div>
        <div><dt>Accession</dt><dd>{row.provenance.accession}</dd></div>
        <div><dt>Concept</dt><dd>{row.provenance.concept}</dd></div>
      </dl>
      <p>{row.provenance.taxonomy}</p>
      {row.provenance.sourceUrls[0] ? (
        <a
          className={styles.externalLink}
          href={row.provenance.sourceUrls[0]}
          rel="noreferrer"
          target="_blank"
        >
          Open SEC filing source
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      ) : null}
    </details>
  );
}

function OwnershipSection({
  events,
  loadState,
  sc13LoadState,
  sc13Snapshot,
  secForm4LoadState,
  secForm4Transactions,
  snapshot,
}: SectionProps & {
  sc13LoadState: FundamentalsLoadState;
  sc13Snapshot: StockSc13OwnershipSnapshot | null;
  secForm4LoadState: FundamentalsLoadState;
  secForm4Transactions: StockForm4Transaction[];
}) {
  const institutionalSummary = snapshot?.ownership.institutionalSummary ?? null;
  const institutionalHolders = snapshot?.ownership.institutionalHolders ?? [];
  const hasOwnershipData =
    Boolean(institutionalSummary) ||
    institutionalHolders.length > 0 ||
    secForm4Transactions.length > 0 ||
    events.length > 0 ||
    Boolean(sc13Snapshot);
  const sc13Pending = !sc13Snapshot
    && (sc13LoadState === "idle" || sc13LoadState === "loading");

  if ((!snapshot && sc13Pending) || (!hasOwnershipData && loadState !== "ready" && sc13Pending)) {
    return (
      <SectionState
        id="watchlist-ownership"
        loadState={loadState}
        number="03"
        title="Ownership"
      />
    );
  }

  const ownershipUnavailable = snapshot
    ? getUnavailableSources(snapshot, ["institutionalOwnership"])
    : [];

  return (
    <section
      aria-labelledby="watchlist-ownership-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      id="watchlist-ownership"
    >
      <DataSectionHeader
        asOf="Stored SEC filings and provider institutional data"
        id="watchlist-ownership-title"
        number="03"
        title="Ownership"
      />
      {ownershipUnavailable.length ? (
        <SourceNotice sources={ownershipUnavailable} />
      ) : null}
      <div className={styles.ownershipOverview}>
        <section
          aria-labelledby="watchlist-ownership-changes"
          className={styles.ownershipChanges}
        >
          <div className={styles.ownershipSubheader}>
            <h3 id="watchlist-ownership-changes">
              SEC Form 4 insider transactions
            </h3>
            <p>Recent stored transactions, not an estimate of total ownership</p>
          </div>
          <div className={styles.ownershipChangeList}>
            {secForm4Transactions.slice(0, 3).map((transaction) => (
              <Form4InsiderActivity
                key={`${transaction.eventId}:${transaction.transactionIndex}`}
                transaction={transaction}
              />
            ))}
            {!secForm4Transactions.length ? (
              <p className={styles.methodNote}>
                {secForm4LoadState === "loading" || secForm4LoadState === "idle"
                  ? "Loading stored SEC Form 4 transactions."
                  : secForm4LoadState === "unavailable"
                    ? "Stored SEC Form 4 transactions are temporarily unavailable."
                    : "No stored SEC Form 4 transactions are available."}
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

      {secForm4Transactions.length > 3 ? (
        <details className={styles.ownershipDisclosure}>
          <DisclosureSummary
            detail={`${secForm4Transactions.length} recent stored transaction${secForm4Transactions.length === 1 ? "" : "s"}`}
            title="All recent SEC Form 4 transactions"
          />
          <div className={styles.ownershipDisclosureBody}>
            <div className={styles.ownershipChangeList}>
              {secForm4Transactions.map((transaction) => (
                <Form4InsiderActivity
                  key={`${transaction.eventId}:${transaction.transactionIndex}`}
                  transaction={transaction}
                />
              ))}
            </div>
          </div>
        </details>
      ) : null}

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

      <Sc13OwnershipDisclosure
        loadState={sc13LoadState}
        snapshot={sc13Snapshot}
      />

      <RelatedFilings
        events={events}
        title="Related ownership filings"
        type="ownership"
      />
    </section>
  );
}

function Sc13OwnershipDisclosure({
  loadState,
  snapshot,
}: {
  loadState: FundamentalsLoadState;
  snapshot: StockSc13OwnershipSnapshot | null;
}) {
  const confirmedCount = snapshot?.status === "available"
    ? snapshot.positions.reduce((count, position) => count + position.currentReporters.length, 0)
    : 0;
  const unresolvedCount = snapshot?.status === "available"
    ? snapshot.positions.filter((position) => position.status === "unresolved").length
    : 0;
  const detail = !snapshot
    ? loadState === "loading" || loadState === "idle"
      ? "Loading stored Schedule 13 history"
      : "Stored Schedule 13 read unavailable"
    : snapshot.status === "available"
      ? `${confirmedCount} confirmed reporter${confirmedCount === 1 ? "" : "s"} · ${unresolvedCount} unconfirmed position${unresolvedCount === 1 ? "" : "s"}`
      : snapshot.status === "empty"
        ? "No stored Schedule 13 history"
        : "Stored Schedule 13 read unavailable";

  return (
    <details className={styles.ownershipDisclosure} open>
      <DisclosureSummary
        detail={detail}
        title="Reported beneficial owners (Schedule 13)"
      />
      <div className={styles.ownershipDisclosureBody}>
        {!snapshot ? (
          <Sc13DataState loading={loadState === "loading" || loadState === "idle"} />
        ) : snapshot.status === "empty" ? (
          <div className={styles.sc13DataState}>
            <strong>No stored Schedule 13 filings</strong>
            <span>No verified Schedule 13 history is stored for this SEC issuer.</span>
          </div>
        ) : snapshot.status === "unavailable" ? (
          <div className={styles.sc13DataState}>
            <strong>Schedule 13 status unavailable</strong>
            <span>{sc13UnavailableMessage(snapshot.reason)}</span>
          </div>
        ) : (
          <div className={styles.sc13Positions}>
            {snapshot.positions.map((position) => (
              <Sc13PositionCard key={position.positionKey} position={position} />
            ))}
          </div>
        )}
        <p className={styles.sc13ScopeNote}>
          “Latest” is limited to the latest value confirmed within the stored
          filing history. It may not include every SEC filing and is not a
          real-time holding. Each reporting person is shown separately;
          joint-reporting amounts are not totaled.
        </p>
      </div>
    </details>
  );
}

function Sc13DataState({ loading }: { loading: boolean }) {
  return (
    <div className={styles.sc13DataState}>
      <strong>{loading ? "Loading stored Schedule 13 history…" : "Schedule 13 status unavailable"}</strong>
      <span>
        {loading
          ? "Schedule 13 history loads independently from the other ownership data."
          : "The stored filing history could not return a complete result."}
      </span>
    </div>
  );
}

function Sc13PositionCard({ position }: { position: StockSc13Position }) {
  return (
    <article className={styles.sc13Position}>
      <header className={styles.sc13PositionHeader}>
        <div>
          <strong>{position.formFamily} · {position.securityClass}</strong>
          <span>CUSIP {position.cusips.join(", ")}</span>
        </div>
        <span className={position.status === "available_stored_history" ? styles.sc13Confirmed : styles.sc13Unresolved}>
          {position.status === "available_stored_history"
            ? "Latest in stored history"
            : "Latest unconfirmed"}
        </span>
      </header>

      {position.status === "available_stored_history" ? (
        <Sc13CurrentReporterTable position={position} />
      ) : (
        <Sc13UnresolvedHistory position={position} />
      )}
    </article>
  );
}

function Sc13CurrentReporterTable({ position }: { position: StockSc13Position }) {
  return (
    <div aria-label="Confirmed Schedule 13 reporting persons" className={styles.sc13Table} role="table">
      <div className={styles.sc13TableHeader} role="row">
        <span role="columnheader">Reporting person</span>
        <span role="columnheader">Reported shares</span>
        <span role="columnheader">Reported % of class</span>
        <span role="columnheader">SEC evidence</span>
      </div>
      {position.currentReporters.map((reporter) => (
        <div className={styles.sc13TableRow} key={reporter.reportingPersonCik} role="row">
          <div className={styles.sc13Reporter} role="cell">
            <strong>{reporter.reportingPersonName}</strong>
            <span>CIK {reporter.reportingPersonCik}</span>
          </div>
          <Sc13FieldCell field={reporter.aggregateAmountOwned} label="Reported shares" suffix="" />
          <Sc13FieldCell field={reporter.percentOfClass} label="Reported % of class" suffix="%" />
          <div className={styles.sc13Evidence} role="cell">
            {uniqueSc13Evidence([reporter.aggregateAmountOwned, reporter.percentOfClass]).map((evidence) => (
              <Sc13EvidenceLink evidence={evidence} key={evidence.accessionNumber} showDates />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Sc13FieldCell({
  field,
  label,
  suffix,
}: {
  field: StockSc13ReportedField;
  label: string;
  suffix: string;
}) {
  if (field.status === "available") {
    return (
      <span className={styles.sc13Value} data-label={label} role="cell">
        {formatSc13Raw(field.valueRaw)}{suffix}
      </span>
    );
  }
  return (
    <span className={styles.sc13Missing} data-label={label} role="cell">
      Not reported in current filing
      {field.lastReported ? (
        <small>
          Historical only: {formatSc13Raw(field.lastReported.valueRaw)}{suffix}
        </small>
      ) : null}
    </span>
  );
}

function Sc13UnresolvedHistory({ position }: { position: StockSc13Position }) {
  return (
    <div className={styles.sc13UnresolvedBody}>
      <div className={styles.sc13IssueNotice}>
        <strong>Latest value is not established by the stored filing history.</strong>
        <span>{position.issueCodes.map(sc13IssueMessage).join(" · ")}</span>
      </div>
      {position.history.map((filing) => (
        <div className={styles.sc13HistoricalFiling} key={filing.accessionNumber}>
          <div className={styles.sc13HistoricalHeader}>
            <div>
              <strong>Stored filing evidence — not a confirmed latest position</strong>
              <span>
                Event date {formatDate(filing.eventDate)} · Filed {formatDate(filing.filedAt)}
              </span>
            </div>
            <Sc13EvidenceLink evidence={filing} />
          </div>
          <div aria-label="Unconfirmed Schedule 13 filing evidence" className={styles.sc13Table} role="table">
            <div className={styles.sc13TableHeader} role="row">
              <span role="columnheader">Reporting person</span>
              <span role="columnheader">Reported shares</span>
              <span role="columnheader">Reported % of class</span>
              <span role="columnheader">Status</span>
            </div>
            {filing.reporters.map((reporter) => (
              <div className={styles.sc13TableRow} key={`${filing.accessionNumber}-${reporter.reportingPersonIndex}`} role="row">
                <div className={styles.sc13Reporter} role="cell">
                  <strong>{reporter.reportingPersonName}</strong>
                  <span>{reporter.reportingPersonCik ? `CIK ${reporter.reportingPersonCik}` : "Reporter CIK not provided"}</span>
                </div>
                <span className={styles.sc13Value} data-label="Reported shares" role="cell">
                  {formatSc13HistoricalRaw(reporter.aggregateAmountOwnedRaw)}
                </span>
                <span className={styles.sc13Value} data-label="Reported % of class" role="cell">
                  {reporter.percentOfClassRaw === null
                    ? "Not reported"
                    : `${formatSc13Raw(reporter.percentOfClassRaw)}%`}
                </span>
                <span className={styles.sc13HistoryStatus} data-label="Status" role="cell">
                  Historical filing value; latest unconfirmed
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Sc13EvidenceLink({
  evidence,
  showDates = false,
}: {
  evidence: StockSc13FilingEvidence;
  showDates?: boolean;
}) {
  return (
    <div className={styles.sc13EvidenceReference}>
      {showDates ? (
        <span>
          Event date {formatDate(evidence.eventDate)} · Filed {formatDate(evidence.filedAt)}
        </span>
      ) : null}
      <a
        className={styles.externalLink}
        href={evidence.sourceUrl}
        rel="noreferrer"
        target="_blank"
      >
        SEC source · {evidence.accessionNumber}
        <ExternalLink aria-hidden="true" size={12} />
      </a>
    </div>
  );
}

function DilutionSection({
  data,
  events,
  isGuest,
  loadState,
}: {
  data: StockDilutionMembershipResponse | null;
  events: StockOverviewEvent[];
  isGuest: boolean;
  loadState: FundamentalsLoadState;
}) {
  if (!data) {
    return (
      <SectionState
        id="watchlist-dilution"
        loadState={loadState}
        number="04"
        title="Dilution"
      />
    );
  }

  const metrics = data.metrics;
  const lockHref = getDilutionLockHref(isGuest, data.symbol);
  return (
    <section
      aria-labelledby="watchlist-dilution-title"
      className={`${watchlistStyles.section} ${styles.fundamentalsSection}`}
      data-dilution-source="stock-radar"
      id="watchlist-dilution"
    >
      <DataSectionHeader
        asOf={`Shares Outstanding as of ${formatDilutionDate(metrics.sharesOutstandingAsOf)} · Last Checked ${formatDilutionDate(data.lastChecked)}`}
        id="watchlist-dilution-title"
        number="04"
        title="Dilution"
      />
      <dl className={styles.dilutionSummary}>
        <Metric
          label="Shares Outstanding"
          note={`As of ${formatDilutionDate(metrics.sharesOutstandingAsOf)}`}
          value={formatDilutionShares(metrics.sharesOutstanding)}
        />
        <Metric
          label="Total Warrant Shares"
          value={formatDilutionShares(metrics.totalWarrantShares)}
        />
        <Metric
          label="Other Warrant Shares"
          value={formatDilutionShares(metrics.otherWarrantShares)}
        />
        <Metric
          label="Convertible Note Potential Shares"
          value={formatDilutionShares(metrics.convertibleNotePotentialShares)}
        />
        <Metric
          label="Equity Line Remaining"
          value={formatTopDilutionMoney(metrics.equityLineRemaining)}
        />
        <Metric
          label="ATM Amount"
          value={formatTopDilutionMoney(metrics.atmAmount)}
        />
      </dl>
      <div className={styles.dilutionStatus}>
        <div>
          <strong>Current dilution instruments</strong>
        </div>
        <div className={styles.dilutionCounts}>
          <span>Current {data.counts.current}</span>
          <span>Closed {data.counts.closed}</span>
          {data.access.canViewHistory && data.old.length ? (
            <span>Old {data.old.length}</span>
          ) : null}
        </div>
      </div>

      <CurrentInstrumentDisclosure
        count={data.counts.current}
        href={lockHref}
        instruments={data.current}
        showDetails={data.access.canViewCurrentDetails}
      />

      {data.access.canViewActivity ? (
        <details className={styles.dilutionDisclosure} open>
          <DisclosureSummary
            detail={`${data.activity.length} recent items`}
            title="Recent Activity"
          />
          <div className={styles.disclosureBody}>
            <div className={styles.dilutionActivityList}>
              {data.activity.map((activity) => (
                <DilutionActivityRow activity={activity} key={activity.key} />
              ))}
            </div>
          </div>
        </details>
      ) : (
        <LockedDilutionDisclosure
          href={lockHref}
          label="View issuance and conversion activity with Advanced"
          title="Recent Activity"
        />
      )}

      {data.access.canViewHistory ? (
        <>
          <InstrumentDisclosure
            count={data.counts.closed}
            instruments={data.closed}
            title="Closed / History"
          />
          {data.old.length ? (
            <InstrumentDisclosure instruments={data.old} title="Old" />
          ) : null}
        </>
      ) : (
        <LockedDilutionDisclosure
          count={data.counts.closed}
          href={lockHref}
          label="View dilution history with Advanced"
          title="Closed / History"
        />
      )}

      <RelatedFilings
        events={events}
        title="Related dilution filings"
        type="dilution"
      />
    </section>
  );
}

function CurrentInstrumentDisclosure({
  count,
  href,
  instruments,
  showDetails,
}: {
  count: number;
  href: string;
  instruments: Array<StockDilutionCurrentPreview | StockDilutionInstrument>;
  showDetails: boolean;
}) {
  return (
    <details className={styles.dilutionDisclosure} open>
      <DisclosureSummary detail={`${count} items`} title="Current Instruments" />
      <div className={styles.disclosureBody}>
        <div className={styles.dilutionInstrumentGrid}>
          {instruments.map((instrument, index) =>
            showDetails ? (
              <DilutionInstrumentCard
                instrument={instrument as StockDilutionInstrument}
                key={`${instrument.name}-${instrument.asOf}-${index}`}
              />
            ) : (
              <DilutionInstrumentPreview
                instrument={instrument}
                key={`${instrument.name}-${instrument.asOf}-${index}`}
              />
            ),
          )}
        </div>
        {!showDetails ? (
          <DilutionLockAction
            href={href}
            label="View all contracts with Pro"
          />
        ) : null}
      </div>
    </details>
  );
}

function LockedDilutionDisclosure({
  count,
  href,
  label,
  title,
}: {
  count?: number;
  href: string;
  label: string;
  title: string;
}) {
  return (
    <details className={styles.dilutionDisclosure} open>
      <DisclosureSummary
        detail={count === undefined ? "Advanced access" : `${count} items`}
        title={title}
      />
      <div className={styles.disclosureBody}>
        <DilutionLockAction href={href} label={label} />
      </div>
    </details>
  );
}

function DilutionLockAction({ href, label }: { href: string; label: string }) {
  return (
    <Link className={styles.dilutionLockAction} href={href}>
      <LockKeyhole aria-hidden="true" size={14} strokeWidth={2} />
      <span>{label}</span>
      <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
    </Link>
  );
}

function DilutionInstrumentPreview({
  instrument,
}: {
  instrument: StockDilutionCurrentPreview;
}) {
  return (
    <article className={`${styles.dilutionInstrumentCard} ${styles.dilutionInstrumentPreview}`}>
      <header>
        <div>
          <strong>{instrument.name}</strong>
          <span>
            {instrumentTypeLabel(instrument.type)} · {statusLabel(instrument.status)}
          </span>
        </div>
        <time dateTime={instrument.asOf}>
          As of {formatDilutionDate(instrument.asOf)}
        </time>
      </header>
    </article>
  );
}

function getDilutionLockHref(isGuest: boolean, symbol: string) {
  if (!isGuest) return "/premium";
  return `/signup?next=${encodeURIComponent(`/stocks/${symbol}`)}`;
}

function instrumentTypeLabel(type: StockDilutionInstrument["type"]) {
  if (type === "convertible_note") return "Convertible note";
  if (type === "convertible_preferred") return "Convertible preferred";
  if (type === "prefunded_warrant") return "Pre-funded warrant";
  if (type === "atm_program") return "ATM program";
  if (type === "equity_line") return "Equity line";
  return "Warrant";
}

function InstrumentDisclosure({
  count,
  instruments,
  title,
}: {
  count?: number;
  instruments: StockDilutionInstrument[];
  title: string;
}) {
  return (
    <details className={styles.dilutionDisclosure} open>
      <DisclosureSummary detail={`${count ?? instruments.length} items`} title={title} />
      <div className={styles.disclosureBody}>
        <div className={styles.dilutionInstrumentGrid}>
          {instruments.map((instrument) => (
            <DilutionInstrumentCard instrument={instrument} key={instrument.key} />
          ))}
        </div>
      </div>
    </details>
  );
}

function DilutionInstrumentCard({ instrument }: { instrument: StockDilutionInstrument }) {
  const fields = instrumentFields(instrument);
  return (
    <article className={styles.dilutionInstrumentCard}>
      <header>
        <div>
          <strong>{instrument.name}</strong>
          <span>
            {instrumentTypeLabel(instrument.type)} · {statusLabel(instrument.status)}
          </span>
        </div>
        <time dateTime={instrument.asOf}>As of {formatDilutionDate(instrument.asOf)}</time>
      </header>
      <dl>
        {fields.map((field) => (
          <div
            className={
              field.label === "Conversion" &&
              field.value.length >= DILUTION_WIDE_CONVERSION_MIN_CHARACTERS
                ? styles.dilutionInstrumentFieldWide
                : undefined
            }
            key={field.label}
          >
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function DilutionActivityRow({ activity }: { activity: StockDilutionActivity }) {
  const sharesIssued = activity.sharesIssued === null
    ? null
    : formatWholeNumber(activity.sharesIssued);
  return (
    <article>
      <time dateTime={activity.date}>{formatDilutionDate(activity.date)}</time>
      <div>
        <strong>{activity.title}</strong>
        {sharesIssued && !activity.title.includes(sharesIssued) ? (
          <span>Shares Issued {sharesIssued}</span>
        ) : null}
        {activity.unitsCancelled !== null ? (
          <span>Units Cancelled {formatWholeNumber(activity.unitsCancelled)}</span>
        ) : null}
      </div>
    </article>
  );
}

function instrumentFields(instrument: StockDilutionInstrument) {
  const fields: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null) => {
    if (value) fields.push({ label, value });
  };
  if (instrument.type === "atm_program") {
    add("Total Amount", instrument.originalCapacity === null ? null : formatDilutionMoney(instrument.originalCapacity));
    add("Used Amount", instrument.usedAmount === null ? "Unknown" : formatDilutionMoney(instrument.usedAmount));
    add("Remaining Amount", instrument.remainingAmount === null ? "Unknown" : formatDilutionMoney(instrument.remainingAmount));
  } else if (instrument.type === "equity_line") {
    add("Total Amount", instrument.originalCapacity === null ? null : formatDilutionMoney(instrument.originalCapacity));
    add("Used Amount", instrument.usedAmount === null ? null : formatDilutionMoney(instrument.usedAmount));
    add("Remaining Amount", instrument.remainingAmount === null ? null : formatDilutionMoney(instrument.remainingAmount));
    add("Shares Issued", formatWholeNumberOrNull(instrument.sharesIssued));
  } else {
    add("Original Amount", formatInstrumentMoney(instrument.originalAmount));
    add("Remaining Amount", formatInstrumentMoney(instrument.remainingAmount));
    add("Remaining Units", instrument.remainingUnits === null ? null : formatDilutionShares(instrument.remainingUnits));
    add("Potential Shares", instrument.remainingPotentialShares === null ? null : formatDilutionShares(instrument.remainingPotentialShares));
  }
  add("Interest", instrument.interestRate === null ? null : `${formatPlainNumber(instrument.interestRate)}%`);
  add("Conversion Price", formatDilutionPrice(instrument.conversionPrice));
  add("Exercise Price", formatDilutionPrice(instrument.exercisePrice));
  add("Conversion", normalizePriceFormula(instrument.priceFormula));
  add("Can Exercise From", instrument.availableDate ? formatDilutionDate(instrument.availableDate) : null);
  add("Start Date", instrument.startDate ? formatDilutionDate(instrument.startDate) : null);
  add("Expires", instrument.endDate ? formatDilutionDate(instrument.endDate) : null);
  add("Shares Issued", instrument.type === "equity_line" ? null : formatWholeNumberOrNull(instrument.sharesIssued));
  return fields;
}

function statusLabel(status: StockDilutionInstrument["status"]) {
  if (status === "current") return "Current";
  if (status === "old") return "Old";
  return "Closed";
}

function normalizePriceFormula(value: string) {
  if (!value) return null;
  return value
    .replace(/^Lesser of/i, "Lower of")
    .replace(/90% of the lowest VWAP over the prior 10 trading days/i, "90% of lowest 10-day VWAP");
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

function Form4InsiderActivity({ transaction }: { transaction: StockForm4Transaction }) {
  return (
    <article>
      <time className={styles.ownershipFilingDate} dateTime={transaction.transactionDate ?? transaction.filedAt}>
        <span>{formatDateShort(transaction.transactionDate ?? transaction.filedAt)}</span>
        <small>Form {transaction.filingForm}</small>
      </time>
      <span className={styles.ownershipFilingBadge}>{transaction.transactionCode ?? "TRADE"}</span>
      <div>
        <strong>{transaction.securityTitle ?? "Security not specified"} · {formatInteger(transaction.shares)}</strong>
        <p>{formatPrice(transaction.pricePerShare)} per share · Transaction {formatDate(transaction.transactionDate)} · Filed {formatDate(transaction.filedAt)}</p>
        <p>
          Reporting owners: {transaction.reportingOwners.map((owner, index) => (
            <span key={`${owner.name}:${index}`}>
              {index > 0 ? "; " : ""}{owner.name}
              {owner.relation ? ` · ${owner.relation === "direct" ? "Direct" : "Indirect"}` : ""}
              {owner.relation && owner.footnoteIds.length ? ` (${owner.footnoteIds.join(", ")})` : ""}
            </span>
          ))}
        </p>
        <p><Link href={`/filings/${transaction.eventId}`}>View filing and source</Link></p>
      </div>
    </article>
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
    institutionalOwnership: "institutional ownership",
    sharesFloat: "share float",
    sharesHistory: "shares outstanding history",
    splits: "stock splits",
  };
  return names[source];
}

function formatInstitutionalPeriod(
  summary: StockFundamentalsSnapshot["ownership"]["institutionalSummary"],
) {
  if (!summary) return "period unavailable";
  if (summary.year && summary.quarter) return `Q${summary.quarter} ${summary.year}`;
  return formatDate(summary.asOf);
}

function formatFinancialFilingSummary(
  filing: StockFinancialCategorySnapshot["latestFiling"],
) {
  return filing
    ? `${filing.form} · report ${formatDate(filing.reportDate)} · filed ${formatDate(filing.filedDate)}`
    : "No canonical filing available";
}

function basisLabel(value: StockFinancialBasis | null) {
  if (value === "QUARTER") return "Quarter";
  if (value === "QUARTER_AND_YEAR_TO_DATE") return "Quarter + YTD";
  if (value === "YEAR_TO_DATE") return "YTD";
  if (value === "ANNUAL") return "Annual";
  if (value === "INSTANT") return "Instant";
  return "Unresolved";
}

function formatUnavailableReason(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function formatFinancialMoney(value: string, currency: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: 2,
      notation: "compact",
      style: "currency",
    }).format(numeric);
  } catch {
    return `${currency} ${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      notation: "compact",
    }).format(numeric)}`;
  }
}

function formatFinancialDelta(row: StockFinancialMetricRow) {
  if (row.delta === null) return "—";
  const negative = row.delta.startsWith("-");
  const unsigned = row.delta.replace(/^-/, "");
  const formatted = formatFinancialMoney(unsigned, row.value.currency);
  if (row.delta === "0") return formatted;
  return `${negative ? "−" : "+"}${formatted}`;
}

function formatSecPeriod(value: StockFinancialValue["period"]) {
  return value.kind === "instant"
    ? `As of ${formatDate(value.instant)}`
    : `${formatDate(value.startDate)} – ${formatDate(value.endDate)}`;
}

function formatDilutionMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatTopDilutionMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatInstrumentMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= 1_000_000) return formatDilutionMoney(value);
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDilutionShares(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(value);
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatWholeNumberOrNull(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : formatWholeNumber(value);
}

function formatDilutionPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatPlainNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function formatDilutionDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`))) {
    return "Unavailable";
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
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

function formatSc13Raw(value: string) {
  const match = /^(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const integer = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integer}${match[2] ?? ""}`;
}

function formatSc13HistoricalRaw(value: string | null) {
  return value === null ? "Not reported" : formatSc13Raw(value);
}

function uniqueSc13Evidence(fields: readonly StockSc13ReportedField[]) {
  const evidence = new Map<string, StockSc13FilingEvidence>();
  for (const field of fields) {
    if (field.status === "available") {
      evidence.set(field.evidence.accessionNumber, field.evidence);
    } else if (field.lastReported) {
      evidence.set(field.lastReported.evidence.accessionNumber, field.lastReported.evidence);
    }
  }
  return [...evidence.values()];
}

function sc13IssueMessage(issue: string) {
  if (issue.includes("previous_accession_missing")) return "Predecessor accession was not reported";
  if (issue.includes("missing_predecessor")) return "Referenced predecessor is not in stored history";
  if (issue.includes("reporter_identity_unverified")) return "A reporting-person CIK is missing";
  if (issue === "root_missing") return "The root filing is not in stored history";
  if (issue === "missing_amendment_sequence") return "The stored amendment sequence is incomplete";
  if (issue.includes("identity_mismatch")) return "Stored filing identities do not match";
  if (issue.includes("filing_order")) return "Filing order could not be verified";
  return "Stored filing lineage could not be verified";
}

function sc13UnavailableMessage(reason: string) {
  if (reason === "issuer_identity_unavailable") return "No stored SEC issuer identity is available for this ticker.";
  if (reason === "issuer_identity_ambiguous") return "This ticker maps to more than one stored SEC issuer identity.";
  if (reason.startsWith("issuer_identity_")) return "The stored SEC issuer identity could not be read completely.";
  if (reason === "reader_projection_invalid") return "Stored filing evidence could not be shown without losing its source context.";
  return "The stored filing history could not return a complete result.";
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

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
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

function changeToneClass(value: string) {
  if (value.startsWith("+")) return styles.positive;
  if (value.startsWith("-") || value.startsWith("−")) return styles.negative;
  return undefined;
}
