import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import { FilingsV2EventBadge } from "@/components/filings-v2/FilingsV2EventBadge";
import { FilingsV2ImpactScore } from "@/components/filings-v2/FilingsV2ImpactScore";
import { FilingsV2InlineAd } from "@/components/filings-v2/FilingsV2InlineAd";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { Pagination, type PaginationItem } from "@/components/ui/Pagination";
import {
  filingsV2SignalLabels,
  type FilingsV2Record,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

export type FilingsV2ListState = "loading" | "ready" | "unavailable";

const minimumInlineAdRecords = 10;
const desktopInlineAdIndex = 9;
const mobileInlineAdIndex = 7;

type FilingsV2ListProps = {
  currentPage: number;
  items: readonly PaginationItem[];
  onPageChange: (page: number) => void;
  onSelect: (record: FilingsV2Record, opener: HTMLElement) => void;
  records: readonly FilingsV2Record[];
  selectedId: string;
  state: FilingsV2ListState;
  totalCount: number;
  totalPages: number;
};

function FilingIdentity({ record }: { record: FilingsV2Record }) {
  return (
    <div className={styles.identity}>
      {record.ticker ? (
        <MarketTickerLogo size="desktop" ticker={record.ticker} />
      ) : (
        <span aria-hidden="true" className={styles.noTickerMark}>SEC</span>
      )}
      <div>
        <strong>{record.ticker ?? "No ticker"}</strong>
        <span title={record.company}>{record.company}</span>
      </div>
    </div>
  );
}

function FilingEvents({ record, mobile = false }: { mobile?: boolean; record: FilingsV2Record }) {
  if (record.events.length === 0) {
    return <span className={styles.metadataEmpty}>No event</span>;
  }

  const visibleEvents = record.events.slice(0, mobile ? 1 : 2);
  return (
    <div className={styles.eventBadges}>
      {visibleEvents.map((event) => (
        <FilingsV2EventBadge event={event} key={event} size={mobile ? "micro" : "small"} />
      ))}
      {record.events.length > visibleEvents.length ? (
        <span aria-label={`${record.events.length - visibleEvents.length} more event`} className={styles.eventOverflow}>
          +{record.events.length - visibleEvents.length}
        </span>
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  record: FilingsV2Record,
  onSelect: FilingsV2ListProps["onSelect"],
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(record, event.currentTarget);
  }
}

function EmptyState({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <div className={styles.emptyState} role="status">
      <strong>{unavailable ? "Mock filing data unavailable" : "No matching filings"}</strong>
      <span>
        {unavailable
          ? "The deterministic fixture is not available in this presentation state."
          : "Clear filters or adjust the search query to show filing records."}
      </span>
    </div>
  );
}

export function FilingsV2List({
  currentPage,
  items,
  onPageChange,
  onSelect,
  records,
  selectedId,
  state,
  totalCount,
  totalPages,
}: FilingsV2ListProps) {
  if (state === "loading") {
    return (
      <section aria-label="Filings loading" aria-live="polite" className={styles.listPanel}>
        <div className={styles.loadingState}>
          <span aria-hidden="true" />
          <strong>Refreshing local mock filings…</strong>
        </div>
      </section>
    );
  }

  if (state === "unavailable") {
    return <section aria-label="Filings unavailable" className={styles.listPanel}><EmptyState unavailable /></section>;
  }

  return (
    <section aria-label="SEC filing list" className={styles.listPanel}>
      {records.length === 0 ? <EmptyState /> : (
        <>
          <div className={styles.desktopTableWrap}>
            <table className={styles.filingTable}>
              <caption className={styles.visuallyHidden}>Mock SEC filings</caption>
              <colgroup>
                <col className={styles.colFiled} />
                <col className={styles.colForm} />
                <col className={styles.colTicker} />
                <col />
                <col className={styles.colEvent} />
                <col className={styles.colSignal} />
                <col className={styles.colImpact} />
                <col className={styles.colSource} />
                <col className={styles.colAction} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Filed</th>
                  <th scope="col">Form</th>
                  <th scope="col">Ticker / Company</th>
                  <th scope="col">Filing</th>
                  <th scope="col">Event</th>
                  <th scope="col">Signal</th>
                  <th scope="col">Impact</th>
                  <th scope="col">Source</th>
                  <th scope="col"><span className={styles.visuallyHidden}>Action</span></th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => {
                  const selected = record.id === selectedId;
                  return (
                    <Fragment key={record.id}>
                      <tr
                        aria-selected={selected}
                        className={selected ? styles.selectedRow : undefined}
                        onClick={(event: MouseEvent<HTMLTableRowElement>) => onSelect(record, event.currentTarget)}
                        onKeyDown={(event) => handleRowKeyDown(event, record, onSelect)}
                        tabIndex={0}
                      >
                        <td><time dateTime={record.filedAt}>{record.filedTime}<small>{record.filedDate}</small></time></td>
                        <td><span className={styles.formLabel}>{record.formType}</span></td>
                        <td><FilingIdentity record={record} /></td>
                        <td>
                          <div className={styles.filingCopy}>
                            <strong title={record.title}>{record.title}</strong>
                            <span>{record.summary}</span>
                          </div>
                        </td>
                        <td><FilingEvents record={record} /></td>
                        <td><span className={`${styles.signal} ${styles[record.signal]}`}>{filingsV2SignalLabels[record.signal]}</span></td>
                        <td><FilingsV2ImpactScore score={record.impact} /></td>
                        <td><span className={styles.sourceLabel}>{record.source}</span></td>
                        <td>
                          <span className={styles.rowAction}>
                            {selected ? <b>Selected</b> : <span>View</span>}
                            <ChevronRight aria-hidden="true" size={15} />
                          </span>
                        </td>
                      </tr>
                      {records.length >= minimumInlineAdRecords && index === desktopInlineAdIndex
                        ? <FilingsV2InlineAd format="desktop" />
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul aria-label="Mobile SEC filing list" className={styles.mobileList}>
            {records.map((record, index) => {
              const selected = record.id === selectedId;
              return (
                <Fragment key={record.id}>
                  <li>
                    <button
                      aria-label={`${record.formType} filing for ${record.ticker ?? record.company}`}
                      aria-pressed={selected}
                      className={`${styles.mobileRow}${selected ? ` ${styles.selectedMobileRow}` : ""}`}
                      onClick={(event) => onSelect(record, event.currentTarget)}
                      type="button"
                    >
                      <span className={styles.mobileTopline}>
                        <time dateTime={record.filedAt}>{record.filedTime}</time>
                        <span className={styles.formLabel}>{record.formType}</span>
                        <strong>{record.ticker ?? "No ticker"}</strong>
                      </span>
                      <span className={styles.mobileImpact}><FilingsV2ImpactScore compact score={record.impact} /></span>
                      <span className={styles.mobileCompany}>{record.company}</span>
                      <span className={styles.mobileTitle}>{record.title}</span>
                      <span className={styles.mobileMeta}>
                        <FilingEvents mobile record={record} />
                        <span className={`${styles.signal} ${styles[record.signal]}`}>{filingsV2SignalLabels[record.signal]}</span>
                        <span>{record.source}</span>
                        {selected ? <b>Selected</b> : null}
                      </span>
                    </button>
                  </li>
                  {records.length >= minimumInlineAdRecords && index === mobileInlineAdIndex
                    ? <FilingsV2InlineAd format="mobile" />
                    : null}
                </Fragment>
              );
            })}
          </ul>
        </>
      )}

      <footer className={styles.listFooter}>
        <span>{totalCount} filings · Page {currentPage} of {totalPages}</span>
        {totalPages > 1 ? (
          <Pagination
            ariaLabel="Filings pages"
            currentPage={currentPage}
            items={items}
            onPageChange={onPageChange}
            totalPages={totalPages}
          />
        ) : null}
      </footer>
    </section>
  );
}
