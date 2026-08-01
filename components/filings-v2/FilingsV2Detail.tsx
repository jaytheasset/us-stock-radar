import type { RefObject } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Star } from "lucide-react";
import { FilingsV2EventBadge } from "@/components/filings-v2/FilingsV2EventBadge";
import { FilingsV2ImpactScore } from "@/components/filings-v2/FilingsV2ImpactScore";
import { FilingsRailAdSlot } from "@/components/filings-v2/FilingsRailAdSlot";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  filingsV2SignalLabels,
  type FilingsV2RelatedFiling,
  type FilingsV2Record,
} from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2DetailContentProps = {
  record: FilingsV2Record;
  relatedRecords: readonly FilingsV2RelatedFiling[];
  showAds: boolean;
};

export function FilingsV2DetailContent({
  record,
  relatedRecords,
  showAds,
}: FilingsV2DetailContentProps) {
  return (
    <div className={styles.detailContent}>
      <div className={styles.detailPreviewCard}>
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          {record.ticker ? (
            <MarketTickerLogo size="detail" ticker={record.ticker} />
          ) : (
            <span aria-hidden="true" className={styles.noTickerMark}>SEC</span>
          )}
          <div>
            <h2 title={record.ticker ? undefined : "Ticker unavailable"}>
              {record.ticker ?? "N/A"}
            </h2>
            <p>{record.company}</p>
          </div>
          {record.watchlist !== undefined ? (
            <span className={styles.watchlistStatus}>
              <Star aria-hidden="true" size={14} />
              <span className={styles.watchlistStatusText}>
                {record.watchlist ? "Watchlist" : "Not watched"}
              </span>
            </span>
          ) : null}
        </div>

        <div className={styles.detailClassification}>
          <span className={styles.formLabel}>{record.formType}</span>
          {record.events.map((event) => <FilingsV2EventBadge event={event} key={event} />)}
          {!record.events.length ? (
            <span className={styles.metadataEmpty}>No event classification</span>
          ) : null}
        </div>

        <div className={styles.detailFacts}>
          <span><b>Filed</b>{record.filedDateTime}</span>
          <span>
            <b>Signal</b>
            <i className={`${styles.signal} ${styles[record.signal]}`}>
              {filingsV2SignalLabels[record.signal]}
            </i>
          </span>
          <span>
            <b>Impact</b>
            <FilingsV2ImpactScore score={record.impact} signal={record.signal} />
          </span>
        </div>
      </header>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Filing Brief</span>
        <h3>{record.title}</h3>
        {record.summary ? <p>{record.summary}</p> : null}
      </section>

      {record.keyPoints.length ? (
        <section className={styles.detailSection}>
          <span className={styles.sectionLabel}>Key points</span>
          <ul>
            {record.keyPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      ) : null}

      <section className={styles.sourceMetadata}>
        <div><span>Source</span><strong>{record.source} EDGAR</strong></div>
        <div><span>Accession</span><strong>{record.accession || "—"}</strong></div>
      </section>

      <div className={styles.detailActionArea}>
        <Link className={styles.detailCta} href={`/filings/${record.id}`}>
          <FileText aria-hidden="true" size={17} />
          View Filing Details
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
      </div>

      {showAds ? (
        <section className={styles.detailAdArea}>
          <FilingsRailAdSlot size="300x250" />
          <FilingsRailAdSlot size="320x100" />
        </section>
      ) : null}

      {relatedRecords.length ? (
        <section className={styles.relatedSection}>
          <span className={styles.sectionLabel}>Related filings</span>
          {relatedRecords.map((related) => (
            <Link className={styles.relatedRow} href={`/filings/${related.id}`} key={related.id}>
              <span className={styles.formLabel}>{related.formType}</span>
              <div>
                <strong>{related.title}</strong>
                <span>{[related.filedDate, related.source].filter(Boolean).join(" · ")}</span>
              </div>
            </Link>
          ))}
        </section>
      ) : null}

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
