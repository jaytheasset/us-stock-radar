"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import type { SituationCardItem } from "@/lib/liveFeed";
import styles from "./StockRadarFeedV2.module.css";

const compactLabels: Readonly<Record<string, string>> = {
  "Dilution Risk": "Dilution",
  "Insider / Ownership": "Insider",
  "Listing Risk": "Listing",
};

export function FeedSituationBoard({
  items,
}: {
  items: readonly SituationCardItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const gridId = useId();

  return (
    <section
      aria-label="Market situation summary"
      className={styles.situationSection}
      data-expanded={expanded}
    >
      <div className={styles.situationGrid} id={gridId}>
        {items.length ? (
          items.map((item, index) => (
            <article className={styles.situationCard} key={item.label}>
              <span>
                <span className={styles.situationLabelFull}>{item.label}</span>
                {compactLabels[item.label] ? (
                  <span className={styles.situationLabelCompact}>
                    {compactLabels[item.label]}
                  </span>
                ) : null}
              </span>
              <strong>{item.value}</strong>
              <small>{item.window}</small>
              {index === 0 ? (
                <IconButton
                  aria-controls={gridId}
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? "Hide situation details"
                      : "Show situation details"
                  }
                  className={styles.situationToggle}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <ChevronDown aria-hidden="true" size={15} />
                </IconButton>
              ) : null}
            </article>
          ))
        ) : (
          <div className={styles.situationEmpty}>
            Situation counts are temporarily unavailable.
          </div>
        )}
      </div>
    </section>
  );
}
