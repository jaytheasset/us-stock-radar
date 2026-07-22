import { PremiumUpgradeCard } from "@/components/news-v2/PremiumUpgradeCard";
import type {
  NewsV2SectorActivity,
  NewsV2SignalActivity,
  NewsV2SourceActivity,
} from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

type NewsV2InsightRailProps = {
  sectorActivity: NewsV2SectorActivity[];
  signalActivity: NewsV2SignalActivity[];
  sourceActivity: NewsV2SourceActivity[];
  total: number;
};

export function NewsV2InsightRail({
  sectorActivity,
  signalActivity,
  sourceActivity,
  total,
}: NewsV2InsightRailProps) {
  return (
    <aside aria-label="News activity" className={styles.insightRail}>
      <div className={styles.insightRailContent}>
        <section className={styles.insightCard}>
          <header className={styles.insightHeader}>
            <div>
              <span>LIVE COVERAGE</span>
              <h2>Market News Radar</h2>
              <p>{total} current news events</p>
            </div>
          </header>
          <ActivityRows
            rows={sourceActivity.map((item) => ({
              label: item.source,
              count: item.count,
              score: item.averageScore,
            }))}
          />
        </section>

        <PremiumUpgradeCard />

        <section className={styles.insightCard}>
          <header className={styles.insightHeader}>
            <div>
              <span>NEWS FLOW</span>
              <h2>Sector Activity</h2>
              <p>Coverage count and average impact</p>
            </div>
          </header>
          <ActivityRows
            rows={sectorActivity.map((item) => ({
              label: item.sector,
              count: item.count,
              score: item.averageScore,
            }))}
          />
        </section>

        <section className={styles.insightCard}>
          <header className={styles.insightHeader}>
            <div>
              <span>DOMINANT SIGNALS</span>
              <h2>Trending Signal Map</h2>
              <p>Most frequent themes and event types</p>
            </div>
          </header>
          <ul className={styles.sourceActivityList}>
            {signalActivity.map((item) => (
              <li className={styles.sourceActivityRow} key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.sentiment} · avg. impact {item.averageScore}</span>
                </div>
                <b>{item.count}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

function ActivityRows({ rows }: { rows: Array<{ label: string; count: number; score: number }> }) {
  if (!rows.length) return <p className={styles.detailEmptyMeta}>No activity data available.</p>;

  return (
    <ul className={styles.sourceActivityList}>
      {rows.map((item) => (
        <li className={styles.sourceActivityRow} key={item.label}>
          <div>
            <strong>{item.label}</strong>
            <span>Average impact {item.score}</span>
          </div>
          <b>{item.count}</b>
        </li>
      ))}
    </ul>
  );
}
