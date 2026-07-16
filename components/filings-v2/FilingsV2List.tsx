import { Fragment } from "react";
import { FilingsV2EventBadge } from "@/components/filings-v2/FilingsV2EventBadge";
import { FilingsV2ImpactScore } from "@/components/filings-v2/FilingsV2ImpactScore";
import { FilingsV2InlineAd } from "@/components/filings-v2/FilingsV2InlineAd";
import { FilingsV2MarketReaction } from "@/components/filings-v2/FilingsV2MarketReaction";
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
    <span className={styles.identity}>
      <strong>{record.ticker ?? "No ticker"}</strong>
      <span title={record.company}>{record.company}</span>
    </span>
  );
}

function FilingEvents({ record, mobile = false }: { mobile?: boolean; record: FilingsV2Record }) {
  if (record.events.length === 0) {
    return <span className={styles.metadataEmpty}>No event</span>;
  }

  const visibleEvents = record.events.slice(0, mobile ? 1 : 2);
  return (
    <span className={styles.eventBadges}>
      {visibleEvents.map((event) => (
        <FilingsV2EventBadge event={event} key={event} size={mobile ? "micro" : "small"} />
      ))}
      {record.events.length > visibleEvents.length ? (
        <span aria-label={`${record.events.length - visibleEvents.length} more event`} className={styles.eventOverflow}>
          +{record.events.length - visibleEvents.length}
        </span>
      ) : null}
    </span>
  );
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
      <header className={styles.listHeader}>
        <div className={styles.listHeaderTitle}>
          <span className={styles.liveLabel}><i aria-hidden="true" />Live</span>
          <h2>SEC Filings</h2>
        </div>
        <span className={styles.listHeaderCount}>{records.length} of {totalCount} filings</span>
      </header>
      {records.length === 0 ? <EmptyState /> : (
        <>
          <div aria-label="Mock SEC filings" className={styles.filingList}>
            {records.map((record, index) => {
              const selected = record.id === selectedId;
              return (
                <Fragment key={record.id}>
                  <div className={styles.filingItemSlot}>
                    <button
                      aria-label={`${record.formType} filing for ${record.ticker ?? record.company}`}
                      aria-pressed={selected}
                      className={`${styles.filingItem}${selected ? ` ${styles.selectedFilingItem}` : ""}`}
                      onClick={(event) => onSelect(record, event.currentTarget)}
                      type="button"
                    >
                      <time className={styles.filingItemTime} dateTime={record.filedAt}>
                        <span>{record.filedDate}</span>
                        <span>{record.filedTime}</span>
                      </time>
                      <FilingIdentity record={record} />
                      <span className={styles.filingCopy}>
                        <span className={styles.filingMeta}>
                          <FilingEvents mobile record={record} />
                          <span className={styles.mobileFiledAt}>{record.filedDate} {record.filedTime}</span>
                          <span>{record.source} · {record.formType}</span>
                        </span>
                        <span className={styles.filingTitle} title={record.title}>{record.title}</span>
                      </span>
                      <FilingsV2MarketReaction recordId={record.id} signal={record.signal} ticker={record.ticker} />
                      <span className={styles.filingImpact}>
                        <span className={`${styles.signal} ${styles[record.signal]}`}>{filingsV2SignalLabels[record.signal]}</span>
                        <FilingsV2ImpactScore score={record.impact} />
                      </span>
                    </button>
                  </div>
                  {records.length >= minimumInlineAdRecords && index === desktopInlineAdIndex
                    ? <FilingsV2InlineAd format="desktop" />
                    : null}
                  {records.length >= minimumInlineAdRecords && index === mobileInlineAdIndex
                    ? <FilingsV2InlineAd format="mobile" />
                    : null}
                </Fragment>
              );
            })}
          </div>
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
