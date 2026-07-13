"use client";

import { useRef, type KeyboardEvent } from "react";
import styles from "./ChartRangeSelector.module.css";

export const chartRanges = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;

export type ChartRange = (typeof chartRanges)[number];

export type ChartRangeSelectorProps = {
  ariaLabel: string;
  onValueChange: (value: ChartRange) => void;
  value: ChartRange;
};

export function ChartRangeSelector({
  ariaLabel,
  onValueChange,
  value,
}: ChartRangeSelectorProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = chartRanges.indexOf(value);

  if (selectedIndex === -1) {
    throw new Error(`Unsupported chart range: ${value}`);
  }

  const selectRange = (nextRange: ChartRange, nextIndex: number) => {
    if (nextRange !== value) {
      onValueChange(nextRange);
    }

    buttonRefs.current[nextIndex]?.focus();
  };

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % chartRanges.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + chartRanges.length) % chartRanges.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = chartRanges.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const nextRange = chartRanges[nextIndex];
    selectRange(nextRange, nextIndex);
  };

  return (
    <div aria-label={ariaLabel} aria-orientation="horizontal" className={styles.root} role="radiogroup">
      {chartRanges.map((range, index) => {
        const isSelected = range === value;

        return (
          <button
            aria-checked={isSelected}
            className={`${styles.item}${isSelected ? ` ${styles.selected}` : ""}`}
            key={range}
            onClick={() => {
              if (!isSelected) {
                onValueChange(range);
              }
            }}
            onKeyDown={(event) => moveSelection(event, index)}
            ref={(button) => {
              buttonRefs.current[index] = button;
            }}
            role="radio"
            tabIndex={isSelected ? 0 : -1}
            type="button"
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
