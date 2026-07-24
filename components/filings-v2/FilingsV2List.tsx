import { Fragment } from "react";
import { FilingsV2EventBadge } from "@/components/filings-v2/FilingsV2EventBadge";
import { FilingsV2ImpactScore } from "@/components/filings-v2/FilingsV2ImpactScore";
import { FilingsV2InlineAd } from "@/components/filings-v2/FilingsV2InlineAd";
import { FilingsV2MarketReaction } from "@/components/filings-v2/FilingsV2MarketReaction";
import { PremiumUpgradeCard } from "@/components/filings-v2/PremiumUpgradeCard";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import {
  filingsV2SignalLabels,
  isFilingsV2Today,
  type FilingsV2Record,
} from "@/lib/filingsV2Model";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFilingsV2.module.css";

export type FilingsV2ListState = "loading" | "partial" | "ready" | "unavailable";

const minimumInlineAdRecords = 10;
const inlineAdGroupSize = 25;
const mobilePremiumCtaInsertIndex = 3;

type FilingsV2ListProps = {
  onLoadMore?: () => void;
  onSelect: (record: FilingsV2Record, opener: HTMLElement) => void;
  preferredSourceUrl?: string | null;
  records: readonly FilingsV2Record[];
  referenceDate: string;
  remainingCount: number;
  selectedId: string;
  state: FilingsV2ListState;
  totalCount: number;
  viewerPlan: Plan;
};

function shouldInsertInlineAd(index: number, recordCount: number) {
  const groupStart = Math.floor(index / inlineAdGroupSize) * inlineAdGroupSize;
  const groupLength = Math.min(inlineAdGroupSize, recordCount - groupStart);
  if (groupLength < minimumInlineAdRecords) return false;

  const groupMidpoint = groupStart + Math.ceil(groupLength / 2) - 1;
  return index === groupMidpoint;
}

function FilingIdentity({ record }: { record: FilingsV2Record }) {
  return (
    <span className={styles.identity}>
      <strong>{record.ticker ?? "No ticker"}</strong>
      <span title={record.company}>{record.company}</span>
    </span>
  );
}

function FilingEvents({ record, mobile = false }: { mobile?: boolean; record: FilingsV2Record }) {
  if (!record.events.length) {
    return <span className={styles.metadataEmpty}>No event</span>;
  }

  const visibleEvents = record.events.slice(0, mobile ? 1 : 2);
  return (
    <span className={styles.eventBadges}>
      {visibleEvents.map((event) => (
        <FilingsV2EventBadge event={event} key={event} size={mobile ? "micro" : "small"} />
      ))}
      {record.events.length > visibleEvents.length ? (
        <span
          aria-label={`${record.events.length - visibleEvents.length} more event`}
          className={styles.eventOverflow}
        >
          +{record.events.length - visibleEvents.length}
        </span>
      ) : null}
    </span>
  );
}

function EmptyState({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <div className={styles.emptyState} role="status">
      <strong>{unavailable ? "Filing data unavailable" : "No matching filings"}</strong>
      <span>
        {unavailable
          ? "The latest SEC filing data could not be loaded. Try again shortly."
          : "Clear filters or adjust the search query to show filing records."}
      </span>
    </div>
  );
}

export function FilingsV2List({
  onLoadMore,
  onSelect,
  preferredSourceUrl,
  records,
  referenceDate,
  remainingCount,
  selectedId,
  state,
  totalCount,
  viewerPlan,
}: FilingsV2ListProps) {
  if (state === "loading") {
    return (
      <section aria-label="Filings loading" aria-live="polite" className={styles.listPanel}>
        <div className={styles.loadingState}>
          <span aria-hidden="true" />
          <strong>Refreshing SEC filings</strong>
        </div>
      </section>
    );
  }

  if (state === "unavailable") {
    return (
      <section aria-label="Filings unavailable" className={styles.listPanel}>
        <EmptyState unavailable />
      </section>
    );
  }

  return (
    <section aria-label="SEC filing list" className={styles.listPanel}>
      <header className={styles.listHeader}>
        <div className={styles.listHeaderTitle}>
          <span className={styles.liveLabel}><i aria-hidden="true" />Live</span>
          <h2>SEC Filings</h2>
          {preferredSourceUrl ? (
            <GooglePreferredSourceLink header href={preferredSourceUrl} />
          ) : null}
        </div>
        <span className={styles.listHeaderCount}>{records.length} of {totalCount} filings</span>
      </header>

      {state === "partial" ? (
        <div className={styles.partialDataNotice} role="status">
          Some filing data could not be loaded. Results may be incomplete.
        </div>
      ) : null}

      {records.length === 0 ? <EmptyState /> : (
        <div aria-label="SEC filings" className={styles.filingList}>
          {records.map((record, index) => {
            const selected = record.id === selectedId;
            const showInlineAd = shouldInsertInlineAd(index, records.length);
            const filingDateLabel = isFilingsV2Today(record.filedAt, referenceDate)
              ? "Today"
              : record.filedDate;

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
                      <span>{filingDateLabel}</span>
                      <span>{record.filedTime}</span>
                    </time>
                    <FilingIdentity record={record} />
                    <span className={styles.filingCopy}>
                      <span className={styles.filingMeta}>
                        <span className={styles.formLabel}>{record.formType}</span>
                        <span className={styles.desktopFilingEvents}><FilingEvents record={record} /></span>
                        <span className={styles.mobileFilingEvents}><FilingEvents mobile record={record} /></span>
                        <time className={styles.mobileFiledAt} dateTime={record.filedAt}>
                          <span className={styles.mobileFiledDate}>{filingDateLabel}</span>
                          <span className={styles.mobileFiledTime}>{record.filedTime}</span>
                        </time>
                        <span className={styles.filingSource}>{record.source}</span>
                      </span>
                      <span className={styles.filingTitle} title={record.title}>{record.title}</span>
                    </span>
                    <FilingsV2MarketReaction record={record} />
                    <span className={styles.filingImpact}>
                      <span className={`${styles.signal} ${styles[record.signal]}`}>
                        {filingsV2SignalLabels[record.signal]}
                      </span>
                      <FilingsV2ImpactScore score={record.impact} />
                    </span>
                  </button>
                </div>
                {showInlineAd ? <FilingsV2InlineAd format="desktop" /> : null}
                {showInlineAd ? <FilingsV2InlineAd format="mobile" /> : null}
                {viewerPlan !== "ultimate" && index === mobilePremiumCtaInsertIndex ? (
                  <PremiumUpgradeCard
                    className={styles.premiumCtaMobile}
                    viewerPlan={viewerPlan}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </div>
      )}

      <footer className={styles.listFooter}>
        {onLoadMore ? (
          <button className={styles.loadMoreButton} onClick={onLoadMore} type="button">
            View more filings
            <span>{remainingCount} more</span>
          </button>
        ) : (
          <span aria-live="polite" className={styles.listComplete}>{records.length} filings shown</span>
        )}
      </footer>
    </section>
  );
}
