import { hasCurrentListingRisk, listingStatusLabels, tradingStatusLabels, listingStatusReasonLabels,
  type StockListingStatus as Status } from "@/lib/watchlist/stockListingStatus";
import styles from "./StockListingStatus.module.css";

export function StockListingStatus({ data }: { data: Status }) {
  if (!hasCurrentListingRisk(data)) return null;
  const facts = data.automatic;
  const dates = [
    [facts.listing === "removal_pending" ? "Scheduled removal" : "Removal effective", facts.removalDate],
    [facts.trading === "suspension_scheduled" ? "Scheduled suspension" : "Suspension effective", facts.suspensionDate],
    ["Withdrawal notice", facts.withdrawalNoticeDate], ["Trading resumed", facts.resumptionDate],
  ];
  return <section className={styles.panel} aria-labelledby="sec-listing-status-title" data-testid="sec-listing-status">
    <div className={styles.heading}>
      <h2 id="sec-listing-status-title">Listing Risk</h2>
      <a href={`/api/stocks/${encodeURIComponent(data.ticker)}/listing-status`}>View JSON</a>
    </div>
    {data.availability === "unavailable" ? <p role="status">{listingStatusReasonLabels.reader_unavailable}</p> : <>
      <dl className={styles.facts}>
        <div><dt>Listing status</dt><dd>{listingStatusLabels[facts.listing]}</dd></div>
        <div><dt>Trading status</dt><dd>{tradingStatusLabels[facts.trading]}</dd></div>
        {data.security && <>
          <div><dt>Security / class</dt><dd>{data.security.title}</dd></div>
          <div><dt>Exchange</dt><dd>{data.security.exchange}</dd></div>
        </>}
        {dates.filter(([, value]) => value).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {data.reason && <p>{listingStatusReasonLabels[data.reason]}</p>}
      {data.sources.length > 0 && <details className={styles.evidence}>
        <summary>SEC source filings ({data.sources.length})</summary>
        <ul>{data.sources.map(source => <li key={`${source.url}-${source.role}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.form} · {source.accession}</a>
          {` · Filed ${source.filingDate}${source.role === "closed_event" ? " · Earlier event closed by a linked filing" : ""}`}
        </li>)}</ul>
      </details>}
      {data.reviewedDates.length > 0 && <div className={styles.evidence}>
        <h3>Human-reviewed dates</h3>
        <p>Separate from the automatic status above.</p>
        <ul>{data.reviewedDates.map((fact, i) => <li key={`${fact.accession}-${fact.field}-${i}`}>
          {fact.field === "notice_date" ? "Notice / receipt date" : "Suspension effective date"}
          {`: ${fact.availability === "unknown" ? "Unknown" : fact.value} · `}
          <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">{fact.accession}</a>
        </li>)}</ul>
      </div>}
    </>}
    <p className={styles.caption}>As of {data.asOf} · Based on stored SEC filings, not live exchange status.</p>
  </section>;
}
