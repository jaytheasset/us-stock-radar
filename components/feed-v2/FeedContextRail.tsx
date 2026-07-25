"use client";

import { useEffect, useRef } from "react";
import { FeedPremiumCard } from "@/components/feed-v2/FeedPremiumCard";
import { FeedPreviewPanel } from "@/components/feed-v2/FeedPreviewPanel";
import { FeedRailAdSlot } from "@/components/feed-v2/FeedRailAdSlot";
import type { LiveFeedV2RailEvent } from "@/lib/liveFeedV2";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";
import type { MarketPulseItem } from "@/lib/liveFeed";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFeedV2.module.css";

type FeedContextRailProps = {
  alertFilings: readonly LiveFeedV2RailEvent[];
  highImpactNews: readonly LiveFeedV2RailEvent[];
  marketMovingNews: readonly LiveFeedV2RailEvent[];
  marketPulse: readonly MarketPulseItem[];
  previewRequestId: number;
  selectedItem: LiveFeedV2Item | null;
  viewerPlan: Plan;
};

export function FeedContextRail({
  alertFilings,
  highImpactNews,
  marketMovingNews,
  marketPulse,
  previewRequestId,
  selectedItem,
  viewerPlan,
}: FeedContextRailProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!previewRequestId || !window.matchMedia("(min-width: 1181px)").matches) {
      return;
    }

    const preview = previewRef.current;
    const rail = railRef.current;
    if (!preview || !rail) return;

    const target =
      rail.scrollTop +
      preview.getBoundingClientRect().top -
      rail.getBoundingClientRect().top;
    rail.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: Math.max(0, target),
    });
  }, [previewRequestId]);

  return (
    <aside
      aria-label="Market context"
      className={styles.contextRail}
      ref={railRef}
    >
      <section className={styles.contextPanel}>
        <div className={styles.contextPanelHeading}>
          <h2>Market Pulse</h2>
          <span>New York session</span>
        </div>
        {marketPulse.length ? (
          <div className={styles.marketPulseGrid}>
            {marketPulse.map((item) => (
              <article data-tone={item.tone} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        ) : (
          <RailEmpty message="Market pulse cache is unavailable." />
        )}
      </section>

      <div className={styles.contextRailPreview} ref={previewRef}>
        <FeedPreviewPanel item={selectedItem} variant="desktop" />
      </div>

      <FeedPremiumCard
        className={styles.premiumCardDesktop}
        viewerPlan={viewerPlan}
      />

      <RailEventSection
        eyebrow="Top signals"
        items={marketMovingNews}
        title="Market-Moving News"
      />
      <RailEventSection
        eyebrow="Highest scores"
        items={highImpactNews}
        title="High-Impact News"
      />

      {viewerPlan === "free" ? <FeedRailAdSlot /> : null}

      <RailEventSection
        eyebrow="SEC monitor"
        items={alertFilings}
        title="Alert Filings"
      />

      <section className={styles.contextPanel}>
        <div className={styles.contextPanelHeading}>
          <h2>Watchlist Activity</h2>
          <span>Not connected</span>
        </div>
        <RailEmpty message="Live Feed watchlist activity does not have a production data contract yet." />
      </section>
    </aside>
  );
}

function RailEventSection({
  eyebrow,
  items,
  title,
}: {
  eyebrow: string;
  items: readonly LiveFeedV2RailEvent[];
  title: string;
}) {
  return (
    <section className={styles.contextPanel}>
      <div className={styles.contextPanelHeading}>
        <h2>{title}</h2>
        <span>{eyebrow}</span>
      </div>
      {items.length ? (
        <div className={styles.contextEventList}>
          {items.map((item) => (
            <article className={styles.contextEvent} key={item.id}>
              <div>
                <span>{item.label}</span>
                <small>{item.timeLabel}</small>
              </div>
              <p>{item.headline}</p>
              <strong>Impact {item.impactScore}</strong>
            </article>
          ))}
        </div>
      ) : (
        <RailEmpty message={`No ${title.toLowerCase()} are available.`} />
      )}
    </section>
  );
}

function RailEmpty({ message }: { message: string }) {
  return <p className={styles.railEmpty}>{message}</p>;
}
