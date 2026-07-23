import type { RefObject } from "react";
import Link from "next/link";
import { Bookmark, ChevronRight, FileText } from "lucide-react";
import { FilingsV2EventBadge } from "@/components/filings-v2/FilingsV2EventBadge";
import { FilingsV2ImpactScore } from "@/components/filings-v2/FilingsV2ImpactScore";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  filingsV2SignalLabels,
  type FilingsV2Record,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2DetailContentProps = {
  record: FilingsV2Record;
  relatedRecords: readonly FilingsV2Record[];
};

export function FilingsV2DetailContent({
  record,
  relatedRecords,
}: FilingsV2DetailContentProps) {
  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          {record.ticker ? (
            <MarketTickerLogo size="detail" ticker={record.ticker} />
          ) : (
            <span aria-hidden="true" className={styles.noTickerMark}>SEC</span>
          )}
          <div>
            <h2>{record.ticker ?? "No ticker"}</h2>
            <p>{record.company}</p>
          </div>
          <span className={styles.watchlistStatus}>
            <Bookmark aria-hidden="true" size={14} />
            <span className={styles.watchlistStatusText}>
              {record.watchlist ? "Watchlist" : "Not watched"}
            </span>
          </span>
        </div>

        <div className={styles.detailClassification}>
          <span className={styles.formLabel}>{record.formType}</span>
          {record.events.map((event) => <FilingsV2EventBadge event={event} key={event} />)}
          {record.events.length === 0 ? <span className={styles.metadataEmpty}>No event classification</span> : null}
        </div>

        <div className={styles.detailFacts}>
          <span><b>Filed</b>{record.filedDateTime}</span>
          <span><b>Signal</b><i className={`${styles.signal} ${styles[record.signal]}`}>{filingsV2SignalLabels[record.signal]}</i></span>
          <span><b>Impact</b><FilingsV2ImpactScore score={record.impact} /></span>
        </div>
      </header>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Filing Brief</span>
        <h3>{record.title}</h3>
        <p>{record.summary}</p>
      </section>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Key points</span>
        <ul>
          {record.keyPoints.map((point) => <li key={point}>{point}</li>)}
        </ul>
      </section>

      <section aria-label="Advertisement" className={styles.detailAdArea}>
        <div className={styles.detailAdSlot}>
          <span className={styles.detailAdLabel}>Advertisement</span>
          <span className={`${styles.detailAdSize} ${styles.detailAdSizeDesktop}`}>300 x 250</span>
          <span className={`${styles.detailAdSize} ${styles.detailAdSizeMobile}`}>320 x 100</span>
        </div>
      </section>

      <section className={styles.sourceMetadata}>
        <div><span>Source</span><strong>{record.source} EDGAR</strong></div>
        <div><span>Accession</span><strong>{record.accession}</strong></div>
      </section>

      {relatedRecords.length > 0 ? (
        <section className={styles.relatedSection}>
          <span className={styles.sectionLabel}>Related filings</span>
          {relatedRecords.map((related) => (
            <div className={styles.relatedRow} key={related.id}>
              <span className={styles.formLabel}>{related.formType}</span>
              <div><strong>{related.title}</strong><span>{related.filedDate} · {related.source}</span></div>
            </div>
          ))}
        </section>
      ) : null}

      <div className={styles.detailActionArea}>
        <Link className={styles.detailCta} href={`/filings/${record.id}`}>
          <FileText aria-hidden="true" size={17} />
          View Filing Details
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </div>
  );
}

type FilingsV2DetailProps = FilingsV2DetailContentProps;

export function FilingsV2DetailPanel(props: FilingsV2DetailProps) {
  return (
    <DetailPanelShell aria-label={`${props.record.formType} filing context`} className={styles.detailPanel}>
      <FilingsV2DetailContent {...props} />
    </DetailPanelShell>
  );
}

export function MobileFilingsV2DetailSheet({
  isOpen,
  onDismiss,
  openerRef,
  ...contentProps
}: FilingsV2DetailProps & {
  isOpen: boolean;
  onDismiss: () => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheetShell
      aria-label={`${contentProps.record.formType} filing detail`}
      closeLabel="Close filing detail"
      id="filings-v2-detail-sheet"
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onDismiss}
      openerRef={openerRef}
      overlayLabel="Close filing detail"
    >
      <FilingsV2DetailContent {...contentProps} />
    </BottomSheetShell>
  );
}
