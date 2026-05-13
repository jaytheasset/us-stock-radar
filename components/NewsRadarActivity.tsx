"use client";

import { useState } from "react";

type ActivityRange = "today" | "fiveDay" | "oneMonth" | "threeMonth";

export type NewsRadarActivityItem = {
  source: string;
  group: string;
  processed: Record<ActivityRange, number>;
  checked: Record<ActivityRange, number>;
};

const rangeOptions: Array<{ key: ActivityRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "fiveDay", label: "5D" },
  { key: "oneMonth", label: "1M" },
  { key: "threeMonth", label: "3M" },
];

export function NewsRadarActivity({ items }: { items: NewsRadarActivityItem[] }) {
  const [activeRange, setActiveRange] = useState<ActivityRange>("today");
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, 3);

  return (
    <section className="source-activity-panel">
      <div className="news-insight-header">
        <div>
          <span>News Radar Activity</span>
          <h2>Processed / checked source flow</h2>
        </div>
        <div className="map-range-controls" aria-label="News radar activity range">
          {rangeOptions.map((option) => (
            <button
              className={option.key === activeRange ? "active" : ""}
              type="button"
              onClick={() => setActiveRange(option.key)}
              key={option.key}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="source-activity-list">
        {visibleItems.map((item) => (
          <SourceActivityRow item={item} range={activeRange} key={item.source} />
        ))}
      </div>

      <div className="source-activity-actions">
        {expanded ? (
          <button type="button" onClick={() => setExpanded(false)}>
            Close
          </button>
        ) : (
          <button type="button" onClick={() => setExpanded(true)}>
            See all sources <span aria-hidden="true">&gt;</span>
          </button>
        )}
      </div>
    </section>
  );
}

function SourceActivityRow({ item, range }: { item: NewsRadarActivityItem; range: ActivityRange }) {
  return (
    <div className="source-activity-row">
      <div>
        <strong>{item.source}</strong>
        <span>{item.group}</span>
      </div>
      <b>
        {item.processed[range]} / {item.checked[range]}
      </b>
    </div>
  );
}
