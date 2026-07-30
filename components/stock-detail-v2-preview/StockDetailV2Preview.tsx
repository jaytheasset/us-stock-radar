import {
  ArrowDownAZ,
  Bell,
  Check,
  ChevronRight,
  ExternalLink,
  Search,
  Trash2,
} from "lucide-react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import watchlistStyles from "@/components/watchlist-v2/StockRadarWatchlistV2.module.css";
import styles from "./StockDetailV2Preview.module.css";

const financialRows = [
  ["Revenue", "$9.25B", "$10.27B", "$9.84B", "$10.61B"],
  ["YoY growth", "+35.2%", "+34.1%", "+32.3%", "+30.7%"],
  ["Gross margin", "52.1%", "53.0%", "52.5%", "53.2%"],
  ["Operating margin", "15.2%", "18.4%", "16.5%", "18.7%"],
  ["Diluted EPS", "$0.92", "$1.09", "$0.96", "$1.14"],
  ["Free cash flow", "$1.22B", "$1.67B", "$1.43B", "$1.71B"],
] as const;

const ownershipChanges = [
  {
    badge: "13F",
    date: "May 15",
    detail: "Vanguard added 3.2M shares; 18 institutions opened positions.",
    title: "Institutional ownership increased 0.8 pp",
    tone: "positive",
    year: "2026",
  },
  {
    badge: "FORM 4",
    date: "May 12",
    detail: "Most activity came from planned sales and tax withholding.",
    title: "Insiders sold 84K shares net over 90 days",
    tone: "negative",
    year: "2026",
  },
  {
    badge: "13D/G",
    date: "May 06",
    detail: "Three active 13D/G holders remain above the reporting threshold.",
    title: "No new 5% owner filed this quarter",
    tone: "neutral",
    year: "2026",
  },
] as const;

const holders = [
  ["Vanguard Group", "147.4M", "9.1%", "+3.2M", "positive"],
  ["BlackRock", "126.5M", "7.8%", "+1.8M", "positive"],
  ["State Street", "66.8M", "4.1%", "−0.6M", "negative"],
  ["Geode Capital", "37.7M", "2.3%", "+0.4M", "positive"],
] as const;

const dilutionEvents = [
  [
    "May 01",
    "10-Q",
    "Employee equity issuance",
    "Quarterly share count reconciliation",
    "+2.1M actual",
    "Issued",
  ],
  [
    "Feb 18",
    "S-8",
    "Equity plan registration",
    "Reserved capacity; not current issuance",
    "24.0M potential",
    "Available",
  ],
  [
    "Jan 29",
    "8-K",
    "Convertible note update",
    "No new conversion shares disclosed",
    "No change",
    "Closed",
  ],
] as const;

const watchlistItems = [
  ["AMD", "Advanced Micro Devices"],
  ["NVDA", "NVIDIA Corporation"],
  ["AVGO", "Broadcom Inc."],
  ["MSFT", "Microsoft Corporation"],
] as const;

export function StockDetailV2Preview() {
  return (
    <StockRadarAppShell
      activeNavigationItem="watchlist"
      themeMode="user-selectable"
    >
      <div className={watchlistStyles.page}>
        <aside className={styles.previewBanner} aria-label="Preview status">
          <strong>Preview only</strong>
          <span>Sample data · no live data connection · not linked from production navigation</span>
        </aside>

        <div className={watchlistStyles.pageTopline}>
          <div>
            <span>Development / QA workspace</span>
            <h1>Stock Detail V2 Preview</h1>
          </div>
          <button className={watchlistStyles.tickerSheetTrigger} disabled type="button">
            AMD
          </button>
        </div>

        <p className={watchlistStyles.statusMessage}>
          Historical layout reconstruction for review. All visible figures are sample values.
        </p>

        <PreviewStockHeader />

        <div className={watchlistStyles.overviewLayout}>
          <aside className={watchlistStyles.desktopLeftRail}>
            <PreviewWatchlistRail />
          </aside>

          <div className={watchlistStyles.overviewContent}>
            <nav
              aria-label="Preview stock sections"
              className={watchlistStyles.sectionNavigation}
            >
              <a href="#preview-context">
                <span>01</span>
                News &amp; Events
              </a>
              <a aria-current="location" href="#preview-financials">
                <span>02</span>
                Financials
              </a>
              <a href="#preview-ownership">
                <span>03</span>
                Ownership
              </a>
              <a href="#preview-dilution">
                <span>04</span>
                Dilution
              </a>
            </nav>

            <div className={watchlistStyles.detailGrid}>
              <main className={watchlistStyles.detailMain}>
                <section
                  aria-label="Preview scope"
                  className={styles.scopeNote}
                  id="preview-context"
                >
                  <span>RESTORED SCOPE</span>
                  <strong>02 Financials · 03 Ownership · 04 Dilution</strong>
                  <p>
                    The surrounding rails follow the current Stock Overview geometry.
                    Only the three historical center sections are reproduced here.
                  </p>
                </section>

                <FinancialsSection />
                <OwnershipSection />
                <DilutionSection />
              </main>

              <aside aria-label="AMD event context" className={watchlistStyles.contextRail}>
                <PreviewEventContext />
                <PreviewCompanyContext />
              </aside>
            </div>
          </div>
        </div>
      </div>
    </StockRadarAppShell>
  );
}

function PreviewStockHeader() {
  return (
    <header className={watchlistStyles.stockHeader}>
      <div className={watchlistStyles.stockIdentity}>
        <span aria-hidden="true">AMD</span>
        <div>
          <div>
            <h2>AMD</h2>
            <small>NASDAQ</small>
          </div>
          <p>Advanced Micro Devices, Inc.</p>
        </div>
      </div>
      <div className={watchlistStyles.stockQuote}>
        <strong>$177.44</strong>
        <span data-tone="positive">+2.84%</span>
        <small>+$4.90 · sample</small>
      </div>
      <div className={watchlistStyles.stockStatus}>
        <span>SAMPLE DATA</span>
        <small>Historical mock values only</small>
      </div>
      <div className={watchlistStyles.stockActions}>
        <button disabled type="button">
          <Check aria-hidden="true" size={15} />
          Watching
        </button>
        <button disabled type="button">
          <Bell aria-hidden="true" size={15} />
          Set Alert
        </button>
      </div>
    </header>
  );
}

function PreviewWatchlistRail() {
  return (
    <div className={watchlistStyles.watchlistRail}>
      <div className={watchlistStyles.watchlistRailHeader}>
        <div>
          <strong>Watchlist</strong>
          <span>4/∞</span>
        </div>
        <div className={watchlistStyles.sortControl}>
          <button aria-label="Sort watchlist preview" disabled type="button">
            <ArrowDownAZ aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
      <label className={watchlistStyles.tickerSearch}>
        <span aria-hidden="true" className={watchlistStyles.searchIconCell}>
          <Search size={15} />
        </span>
        <input
          aria-label="Ticker search disabled in preview"
          placeholder="Search ticker or company"
          readOnly
        />
      </label>
      <ul className={watchlistStyles.watchlistItems}>
        {watchlistItems.map(([ticker, company]) => (
          <li key={ticker}>
            <button
              aria-current={ticker === "AMD" ? "page" : undefined}
              className={watchlistStyles.watchlistSelect}
              disabled
              type="button"
            >
              <span>
                <strong>{ticker}</strong>
                <small>{company}</small>
              </span>
              <span>View</span>
            </button>
            <button
              aria-label={`Remove ${ticker} disabled in preview`}
              className={watchlistStyles.watchlistRemove}
              disabled
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className={watchlistStyles.railFooter}>
        <span>Preview plan</span>
        <span>Sample only</span>
      </div>
    </div>
  );
}

function FinancialsSection() {
  const keyMetrics = [
    ["Revenue growth", "+30.7%", "Q2 consensus"],
    ["Operating margin", "18.7%", "Q2 consensus"],
    ["FCF margin", "16.1%", "Q2 consensus"],
    ["Net cash", "$3.68B", "Q1 reported"],
    ["Forward P/E", "38.7×", "Next 4Q EPS"],
  ] as const;

  return (
    <section
      aria-labelledby="preview-financials-title"
      className={`${watchlistStyles.section} ${styles.restoredSection}`}
      id="preview-financials"
    >
      <DataSectionHeader
        asOf="Q1 2026 actual · Q2 2026 consensus · SAMPLE"
        id="preview-financials-title"
        number="02"
        title="Financials"
      />

      <div className={styles.financialOverviewGrid}>
        <article className={styles.latestEarnings}>
          <div className={styles.financialCardHeading}>
            <div>
              <span>LATEST EARNINGS</span>
              <h3>Q1 2026</h3>
            </div>
            <time>May 6, 2026 · AMC</time>
          </div>
          <div
            aria-label="Sample latest earnings compared with consensus"
            className={styles.earningsComparison}
            role="table"
          >
            <div className={styles.earningsComparisonHeader} role="row">
              <span role="columnheader">Metric</span>
              <span role="columnheader">Actual</span>
              <span role="columnheader">Estimate</span>
              <span role="columnheader">Surprise</span>
            </div>
            <EarningsRow
              actual="$9.84B"
              estimate="$9.67B"
              metric="Revenue"
              surprise="+1.8%"
              yoy="+32.3% YoY"
            />
            <EarningsRow
              actual="$0.96"
              estimate="$0.93"
              metric="Diluted EPS"
              surprise="+3.2%"
              yoy="+38.1% YoY"
            />
          </div>
          <div className={styles.earningsFooter}>
            <div>
              <span>NEXT-DAY REACTION</span>
              <strong className={styles.positive}>+4.8%</strong>
            </div>
            <div>
              <span>NEXT EARNINGS</span>
              <strong>Q2 2026E</strong>
              <small>Aug 5, 2026 · AMC</small>
            </div>
            <div>
              <span>CONSENSUS</span>
              <strong>$10.61B revenue</strong>
              <small>$1.14 EPS</small>
            </div>
          </div>
        </article>

        <article className={styles.financialChanges}>
          <div className={styles.financialCardHeading}>
            <div>
              <span>STOCK RADAR</span>
              <h3>What Changed</h3>
            </div>
          </div>
          <ul>
            <FinancialChange
              detail="Q1 actual vs. Q4 actual"
              label="Gross margin expanded"
              positive
              value="+50 bps QoQ"
            />
            <FinancialChange
              detail="Next-4Q EPS · 7-day revision"
              label="Consensus moved higher"
              positive
              value="+2.4%"
            />
            <FinancialChange
              detail="Q2 consensus vs. Q1 actual"
              label="Revenue growth moderating"
              value="30.7% YoY"
            />
          </ul>
        </article>
      </div>

      <div className={styles.keyFundamentals}>
        <div className={styles.keyFundamentalsHeading}>
          <strong>Key Fundamentals</strong>
          <span>Actual and forward metrics · sample</span>
        </div>
        <dl>
          {keyMetrics.map(([label, value, note]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              <small>{note}</small>
            </div>
          ))}
        </dl>
      </div>

      <details className={styles.detailDisclosure}>
        <DisclosureSummary
          detail="4 periods · actuals and consensus"
          title="Quarterly trends"
        />
        <div className={styles.disclosureBody}>
          <div
            aria-label="Sample quarterly financial trends"
            className={styles.financialTable}
            role="table"
          >
            <div className={styles.financialHeader} role="row">
              <span role="columnheader">Metric</span>
              {["Q3 '25", "Q4 '25", "Q1 '26", "Q2 '26E"].map((quarter, index) => (
                <span key={quarter} role="columnheader">
                  {quarter}
                  <small>{index === 3 ? "Estimate" : "Actual"}</small>
                </span>
              ))}
            </div>
            {financialRows.map(([metric, ...values]) => (
              <div className={styles.financialRow} key={metric} role="row">
                <strong role="rowheader">{metric}</strong>
                {values.map((value, index) => (
                  <span
                    className={`${metric === "YoY growth" ? styles.positive : ""} ${index === values.length - 1 ? styles.estimatedCell : ""}`}
                    data-label={["Q3 '25", "Q4 '25", "Q1 '26", "Q2 '26E"][index]}
                    key={`${metric}-${value}`}
                    role="cell"
                  >
                    {value}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className={styles.methodNote}>
            Sample presentation only. Estimates are labeled separately from reported values.
          </p>
        </div>
      </details>
    </section>
  );
}

function EarningsRow({
  actual,
  estimate,
  metric,
  surprise,
  yoy,
}: {
  actual: string;
  estimate: string;
  metric: string;
  surprise: string;
  yoy: string;
}) {
  return (
    <div className={styles.earningsComparisonRow} role="row">
      <strong role="rowheader">
        {metric}
        <small>{yoy}</small>
      </strong>
      <span data-label="Actual" role="cell">{actual}</span>
      <span data-label="Estimate" role="cell">{estimate}</span>
      <span className={styles.positive} data-label="Surprise" role="cell">{surprise}</span>
    </div>
  );
}

function FinancialChange({
  detail,
  label,
  positive = false,
  value,
}: {
  detail: string;
  label: string;
  positive?: boolean;
  value: string;
}) {
  return (
    <li>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <b className={positive ? styles.positive : undefined}>{value}</b>
    </li>
  );
}

function OwnershipSection() {
  const summary = [
    ["Institutional", "72.4%", ""],
    ["QoQ change", "+0.8 pp", "positive"],
    ["Institutions", "2,184", ""],
    ["Insider net · 90D", "−$14.2M", "negative"],
    ["5%+ owners", "3", ""],
  ] as const;

  return (
    <section
      aria-labelledby="preview-ownership-title"
      className={`${watchlistStyles.section} ${styles.restoredSection}`}
      id="preview-ownership"
    >
      <DataSectionHeader
        asOf="Q1 2026 13F · filings through May 15 · SAMPLE"
        id="preview-ownership-title"
        number="03"
        title="Ownership"
      />
      <dl className={styles.ownershipSummaryStrip}>
        {summary.map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={tone ? styles[tone] : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.ownershipOverview}>
        <section className={styles.ownershipChanges} aria-labelledby="preview-ownership-changes">
          <div className={styles.ownershipSubheader}>
            <h3 id="preview-ownership-changes">What changed</h3>
            <p>Material ownership filings since the prior quarter</p>
          </div>
          <div className={styles.ownershipChangeList}>
            {ownershipChanges.map((item) => (
              <article key={item.badge}>
                <time className={styles.ownershipFilingDate}>
                  <span>{item.date}</span>
                  <small>{item.year}</small>
                </time>
                <span className={styles.ownershipFilingBadge}>{item.badge}</span>
                <div>
                  <strong className={item.tone === "positive" ? styles.positive : item.tone === "negative" ? styles.negative : undefined}>
                    {item.title}
                  </strong>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className={styles.ownershipSummary}>
          <div className={styles.ownershipSubheader}>
            <h3>Ownership mix</h3>
            <p>Reported and estimated shares outstanding</p>
          </div>
          <div aria-label="Sample ownership distribution" className={styles.ownershipBar} role="img">
            <span className={styles.institutionalBar} style={{ width: "72.4%" }} />
            <span className={styles.insiderBar} style={{ width: "0.5%" }} />
            <span className={styles.otherBar} style={{ width: "27.1%" }} />
          </div>
          <div className={styles.ownershipLegend}>
            {[
              ["Institutional", "72.4%", styles.institutionalDot],
              ["Estimated insider", "0.5%", styles.insiderDot],
              ["Other / unclassified", "27.1%", styles.otherDot],
            ].map(([label, value, className]) => (
              <div key={label}>
                <span className={className} />
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className={styles.ownershipMixNote}>
            Unclassified is a residual estimate, not reported retail ownership.
          </p>
        </div>
      </div>
      <details className={styles.ownershipDisclosure}>
        <DisclosureSummary
          detail="Vanguard leads with 147.4M shares · Q1 2026"
          title="Top institutional holders"
        />
        <div className={styles.ownershipDisclosureBody}>
          <div className={styles.ownershipTable} role="table" aria-label="Sample top institutional holders">
            <div className={styles.ownershipTableHeader} role="row">
              <span role="columnheader">Holder</span>
              <span role="columnheader">Shares</span>
              <span role="columnheader">Ownership</span>
              <span role="columnheader">QoQ change</span>
            </div>
            {holders.map(([holder, shares, ownership, change, tone]) => (
              <div className={styles.ownershipTableRow} key={holder} role="row">
                <strong role="cell">{holder}</strong>
                <span data-label="Shares" role="cell">{shares}</span>
                <span data-label="Ownership" role="cell">{ownership}</span>
                <span className={tone === "positive" ? styles.positive : styles.negative} data-label="QoQ change" role="cell">{change}</span>
              </div>
            ))}
          </div>
          <p className={styles.methodNote}>
            13F positions are quarter-end snapshots. All values here are sample data.
          </p>
        </div>
      </details>
    </section>
  );
}

function DilutionSection() {
  const summary = [
    ["Shares outstanding", "1.62B", "Q1 reported"],
    ["YoY share change", "+0.9%", "Diluted basis"],
    ["SBC · TTM", "$1.48B", "Non-cash expense"],
    ["Buybacks · TTM", "$1.10B", "Cash deployed"],
    ["Net share change", "+14.4M", "Issued less retired"],
    ["Active ATM", "None", "No program found"],
  ] as const;

  return (
    <section
      aria-labelledby="preview-dilution-title"
      className={`${watchlistStyles.section} ${styles.restoredSection}`}
      id="preview-dilution"
    >
      <DataSectionHeader
        asOf="Filings through May 15, 2026 · SAMPLE"
        id="preview-dilution-title"
        number="04"
        title="Dilution"
      />
      <dl className={styles.dilutionSummary}>
        {summary.map(([label, value, detail]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <small>{detail}</small>
          </div>
        ))}
      </dl>
      <div className={styles.dilutionStatus}>
        <div>
          <strong>No active capital raise identified in the sample filing set</strong>
          <p>Registered capacity and actual issuance remain labeled separately.</p>
        </div>
        <span>LOW RISK</span>
      </div>
      <details className={styles.dilutionDisclosure}>
        <DisclosureSummary
          detail="Actual issuance and potential capacity are labeled separately."
          title="Recent share supply activity"
        />
        <div className={styles.disclosureBody}>
          <div className={styles.dilutionEventTable} role="table" aria-label="Sample recent dilution filings">
            <div className={styles.dilutionEventHeader} role="row">
              <span role="columnheader">Filed</span>
              <span role="columnheader">Form</span>
              <span role="columnheader">Event</span>
              <span role="columnheader">Share effect</span>
              <span role="columnheader">Status</span>
            </div>
            {dilutionEvents.map(([date, form, title, detail, effect, status]) => (
              <div className={styles.dilutionEventRow} key={`${date}-${form}`} role="row">
                <time data-label="Filed" role="cell">{date}</time>
                <span className={styles.dilutionForm} data-label="Form" role="cell">{form}</span>
                <div className={styles.dilutionEventDetail} role="cell">
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </div>
                <span className={styles.dilutionEffect} data-label="Share effect" role="cell">{effect}</span>
                <span className={styles.dilutionEventStatus} data-label="Status" role="cell">{status}</span>
              </div>
            ))}
          </div>
          <p className={styles.methodNote}>
            This preview does not evaluate live filings or calculate actual dilution risk.
          </p>
        </div>
      </details>
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

function PreviewEventContext() {
  return (
    <article className={watchlistStyles.eventPreview}>
      <header>
        <div>
          <span>AMD</span>
          <small>Advanced Micro Devices, Inc.</small>
        </div>
        <span data-signal="bullish">bullish</span>
      </header>
      <div className={watchlistStyles.previewClassification}>
        <b>Earnings</b>
        <span>Sample event</span>
      </div>
      <h3>Quarterly results top consensus as data-center demand strengthens</h3>
      <p>
        Sample event context preserves the current right-rail geometry without
        querying news, filings, or market APIs.
      </p>
      <dl>
        <div>
          <dt>Impact</dt>
          <dd data-score-tone="bullish">+7.8</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Historical mock</dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>May 06 · 4:12 PM ET</dd>
        </div>
      </dl>
      <span className={watchlistStyles.previewUnavailable}>
        Full analysis is disabled in this preview.
      </span>
    </article>
  );
}

function PreviewCompanyContext() {
  return (
    <section className={watchlistStyles.companyContext}>
      <span>COMPANY CONTEXT</span>
      <h2>Advanced Micro Devices, Inc.</h2>
      <dl>
        <div>
          <dt>Sector</dt>
          <dd>Technology</dd>
        </div>
        <div>
          <dt>Industry</dt>
          <dd>Semiconductors</dd>
        </div>
        <div>
          <dt>Country</dt>
          <dd>United States</dd>
        </div>
      </dl>
      <p>
        Sample profile copy for layout review only. No company profile endpoint
        is called by this page.
      </p>
      <span className={styles.disabledLink}>
        Company website disabled
        <ExternalLink aria-hidden="true" size={12} />
      </span>
    </section>
  );
}
